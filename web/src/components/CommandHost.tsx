import { type ClientCommand, SESSION_TITLE_MAX, type ServerMessage } from "@shared/wire";
import {
  AppWindowIcon,
  ArchiveIcon,
  CopyIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  ListIcon,
  type LucideIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PinIcon,
  PinOffIcon,
  ScrollTextIcon,
  ShapesIcon,
  Share2Icon,
  SquareIcon,
  SquarePenIcon,
  TextCursorInputIcon,
  Trash2Icon,
  WrapTextIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  type ComponentProps,
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { copyText } from "@/components/CopyButton";
import { FormDialog } from "@/components/FormDialog";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/PianoDialog";
import { DropdownMenuItem } from "@/components/PianoDropdownMenu";
import { ProjectDialogView } from "@/components/Projects";
import { ProjectSettingsDialog } from "@/components/ProjectSettings";
import { RemovalDialog } from "@/components/RemovalDialog";
import { PreviewDetailsDialog } from "@/components/SessionPreview";
import { ShareSessionDialog, type ShareTarget } from "@/components/ShareSessionDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { artifactsMenu } from "@/lib/artifactsMenu";
import { confirmation, FORM_NOT_SENT } from "@/lib/commandForms";
import { type Command, type CommandEffects, runCommand } from "@/lib/commands";
import { type GlobalCommandContext, globalCommands } from "@/lib/globalCommands";
import type { SessionLayout } from "@/lib/navigation";
import { openLink } from "@/lib/openLink";
import { openPageEditor, pageAvailability } from "@/lib/pageEditor";
import { pointerLast } from "@/lib/pointerClose";
import { sessionProjectMenu } from "@/lib/projectCommands";
import {
  type SessionCommand,
  type SessionCommandIcon,
  type SessionTarget,
  sessionCommands,
} from "@/lib/sessionCommands";
import { workspaceFor } from "@/lib/sessionContext";
import { type PreviewClaim, previewClaim } from "@/lib/sessionPreview";
import { useCodeWrap } from "@/lib/useCodeWrap";
import { useCommandForms } from "@/lib/useCommandForms";
import { useMachineScope, useOffers, usePreviewObservation } from "@/lib/useMachine";
import { useMessagesOnly } from "@/lib/useMessagesOnly";
import { useNavigation } from "@/lib/useNavigation";
import { useSidebarLayout } from "@/lib/useSidebarLayout";
import { useSidebarView } from "@/lib/useSidebarView";
import type { SendDisposition } from "@/lib/ws";
import type { AppState } from "@/store";

async function copySessionValue(value: string, label: string) {
  const failure = `Could not copy the ${label[0]?.toLowerCase()}${label.slice(1)}.`;
  if (await copyText(value, failure)) toast.success(`${label} copied`);
}

function previewFocusReturn() {
  const source = document.activeElement as HTMLElement | null;
  const fallback = document.querySelector<HTMLElement>(
    source?.closest("[data-slot=session-rail], [role=menu]")
      ? '[data-slot=session-rail] [aria-label="More preview actions"]'
      : "main header [data-session-menu]",
  );
  return (event: Event) => {
    event.preventDefault();
    if (!pointerLast()) (source?.isConnected ? source : fallback)?.focus({ preventScroll: true });
  };
}

const ICONS: Record<SessionCommandIcon, LucideIcon> = {
  copy: CopyIcon,
  changes: FileDiffIcon,
  wrap: WrapTextIcon,
  artifacts: ShapesIcon,
  list: ListIcon,
  agent: MessagesSquareIcon,
  "pull-request": GitPullRequestIcon,
  preview: AppWindowIcon,
  details: ScrollTextIcon,
  stop: SquareIcon,
  messages: MessageSquareIcon,
  rename: TextCursorInputIcon,
  share: Share2Icon,
  pin: PinIcon,
  unpin: PinOffIcon,
  archive: ArchiveIcon,
  delete: Trash2Icon,
  new: SquarePenIcon,
};

export function CommandIcon({ icon }: { icon: SessionCommandIcon }) {
  const Icon = ICONS[icon];
  return <Icon className={icon === "stop" ? "fill-current" : undefined} />;
}

interface CommandsValue {
  run: (command: Command) => void;
  messagesOnly: boolean;
  layout: SessionLayout;
  codeWrap: boolean;
  state: AppState;
  global: GlobalCommandContext;
}
const CommandsContext = createContext<CommandsValue | null>(null);

export function useCommands() {
  const value = useContext(CommandsContext);
  if (!value) throw new Error("useCommands needs a CommandHost");
  return value;
}

export function useSessionCommands(target?: SessionTarget) {
  const offers = useOffers();
  const { state, run, messagesOnly, codeWrap, layout } = useCommands();
  const observed = usePreviewObservation();
  return {
    commands: sessionCommands(state, target, {
      offers,
      messagesOnly,
      codeWrap,
      layout,
      previewObservation: observed,
    }),
    run,
    messagesOnly,
  };
}

export function useSessionProjectMenu() {
  const { state } = useCommands();
  const offers = useOffers();
  const session = state.session;
  return session?.sessionId
    ? sessionProjectMenu(state, { cwd: session.cwd, sessionId: session.sessionId }, offers)
    : undefined;
}

export function useGlobalCommands() {
  const { state, run, global } = useCommands();
  const offers = useOffers();
  return { commands: globalCommands(state, global, offers), run };
}

export function SessionCommandMenuItem({
  command,
  run,
}: {
  command: SessionCommand;
  run: (command: SessionCommand) => void;
}) {
  return (
    <DropdownMenuItem
      variant={command.destructive ? "destructive" : undefined}
      disabled={!command.enabled}
      onSelect={() => run(command)}
    >
      <CommandIcon icon={command.icon} /> {command.label}
    </DropdownMenuItem>
  );
}

export type LinkCommand = SessionCommand & { intent: { kind: "open-url"; url: string } };

export function useOpenPreview(): LinkCommand | undefined {
  const { commands } = useSessionCommands();
  const command = commands.find((c) => c.id === "open-preview");
  return command?.enabled && command.intent.kind === "open-url" && command.intent.url
    ? (command as LinkCommand)
    : undefined;
}

export function CommandLink({
  command,
  children,
  ...props
}: Omit<ComponentProps<"a">, "href" | "target" | "rel"> & { command: LinkCommand }) {
  return (
    <a {...props} href={command.intent.url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function CommandHost({
  state,
  send,
  decideTrust,
  listen,
  children,
}: {
  state: AppState;
  send: (command: ClientCommand) => SendDisposition;
  decideTrust: (path: string, trusted: boolean) => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
  children: React.ReactNode;
}) {
  const {
    openPage,
    openNew,
    openProjects,
    openProject,
    openChanges,
    toggleRail,
    showAgent,
    openPullRequest,
    openSettings,
    closeSettings,
    settings,
    layout,
  } = useNavigation();
  const machineScope = useMachineScope();
  const previews = machineScope.previews;
  const [messagesOnly, setMessagesOnly] = useMessagesOnly();
  const [codeWrap, setCodeWrap] = useCodeWrap();
  const { view, setView } = useSidebarView();
  const { theme, setTheme } = useTheme();
  const sidebar = useSidebarLayout();
  const sidebarHidden = useSyncExternalStore(sidebar.subscribe, sidebar.getState).hidden;
  useSyncExternalStore(pageAvailability.subscribe, pageAvailability.getState);
  const forms = useCommandForms({
    state,
    send: (command) => {
      const disposition = send(command);
      if (disposition === "not-sent") toast.warning(FORM_NOT_SENT);
      return disposition;
    },
    openPage,
    listen,
  });
  const { form } = forms;
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renaming = form?.kind === "rename-session" ? form.target : null;
  const close = forms.cancel;
  const answer = forms.answer();
  const asking = form ? confirmation(state, form) : undefined;
  const project = form?.kind === "project" ? form.dialog : undefined;
  const projectSettings = form?.kind === "project-settings";
  const [previewDetails, setPreviewDetails] = useState<PreviewClaim | null>(null);
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const detailsFocus = useRef<((event: Event) => void) | undefined>(undefined);
  const stopFocus = useRef<((event: Event) => void) | undefined>(undefined);

  const effects: CommandEffects = {
    switchMachine: machineScope.switchMachine,
    send,
    decideTrust,
    closeSettings,
    openSettings,
    openNew,
    openProjects,
    openProject,
    openChanges,
    openArtifacts: artifactsMenu.open,
    toggleRail,
    showAgent,
    openPullRequest,
    toggleSidebar: sidebar.toggle,
    setView,
    setMessagesOnly,
    setCodeWrap,
    setAppearance: setTheme,
    copy: (value, label) => void copySessionValue(value, label),
    openForm: (form) => {
      stopFocus.current = form.kind === "stop-preview" ? previewFocusReturn() : undefined;
      forms.open(form);
      if (form.kind === "stop-preview") previews?.refresh();
    },
    shareSession: (target) => {
      const workspace = workspaceFor(state, target.cwd);
      if (!workspace) {
        toast.error("Could not find this session’s workspace. Refresh the session list.");
        return;
      }
      setSharing({
        machineId: machineScope.machine.id,
        machineName: machineScope.machine.name,
        workspaceId: workspace.id,
        sessionId: target.sessionId,
        title: target.title || "Untitled session",
      });
    },
    openUrl: openLink,
    openPreviewDetails: () => {
      detailsFocus.current = previewFocusReturn();
      setPreviewDetails(previewClaim(state) ?? null);
      previews?.refresh();
    },
    openPageEditor,
  };
  const run = (command: Command) => runCommand(command, effects);

  return (
    <CommandsContext.Provider
      value={{
        run,
        messagesOnly,
        layout,
        codeWrap,
        state,
        global: {
          machine: machineScope.machine,
          machines: machineScope.machines,
          settings,
          view,
          theme: theme ?? "system",
          sidebarHidden,
        },
      }}
    >
      {children}
      {sharing && (
        <ShareSessionDialog
          target={sharing}
          close={() => setSharing(null)}
          openProviders={() => openSettings("providers")}
        />
      )}
      <FormDialog
        open={!!renaming}
        close={close}
        className="sm:max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          renameInputRef.current?.focus();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            forms.submit();
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Input
                ref={renameInputRef}
                aria-label="Session name"
                value={renaming ? forms.text : ""}
                onChange={(event) => forms.edit(event.target.value)}
                onFocus={(event) => event.target.select()}
                maxLength={SESSION_TITLE_MAX}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!answer.allowed}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </FormDialog>
      <RemovalDialog
        open={!!asking}
        title={asking?.title ?? ""}
        description={asking?.description ?? ""}
        action={asking?.confirmLabel ?? ""}
        destructive={asking?.destructive}
        busy={false}
        disabled={!answer.allowed}
        cancel={close}
        confirm={forms.submit}
        onCloseAutoFocus={stopFocus.current}
      />
      <PreviewDetailsDialog
        claim={previewDetails}
        close={() => setPreviewDetails(null)}
        onCloseAutoFocus={detailsFocus.current}
      />
      <ProjectDialogView
        open={!!project}
        dialog={project}
        draft={forms.projectDraft}
        setDraft={forms.editProject}
        allowed={answer.allowed}
        submit={forms.submit}
        close={close}
      />
      <ProjectSettingsDialog
        open={projectSettings}
        check={answer.projectCheck}
        draft={forms.projectDraft}
        setDraft={forms.editProject}
        allowed={answer.allowed}
        submit={forms.submit}
        close={close}
      />
    </CommandsContext.Provider>
  );
}
