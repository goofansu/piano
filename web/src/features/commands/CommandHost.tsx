import { type ClientCommand, SESSION_TITLE_MAX, type ServerMessage } from "@shared/wire";
import {
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
  ShapesIcon,
  Share2Icon,
  SquarePenIcon,
  TextCursorInputIcon,
  Trash2Icon,
  WrapTextIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { createContext, useContext, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { AppState } from "@/app/store";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { confirmation, FORM_NOT_SENT } from "@/features/commands/commandForms";
import {
  type Command,
  type CommandEffects,
  type CommandForm,
  runCommand,
} from "@/features/commands/commands";
import { type GlobalCommandContext, globalCommands } from "@/features/commands/globalCommands";
import {
  type SessionCommand,
  type SessionCommandIcon,
  type SessionTarget,
  sessionCommands,
} from "@/features/commands/sessionCommands";
import { useCommandForms } from "@/features/commands/useCommandForms";
import type { SessionLayout } from "@/features/navigation/navigation";
import { useSidebarLayout } from "@/features/navigation/sidebar/useSidebarLayout";
import { useSidebarView } from "@/features/navigation/sidebar/useSidebarView";
import { useNavigation } from "@/features/navigation/useNavigation";
import { sessionProjectMenu } from "@/features/projects/projectCommands";
import { ProjectDialogView } from "@/features/projects/Projects";
import { ProjectSettingsDialog } from "@/features/projects/ProjectSettings";
import { artifactsMenu } from "@/features/radius/artifactsMenu";
import { sessionLabel } from "@/features/sessions/sessionCatalog";
import { workspaceFor } from "@/features/sessions/sessionContext";
import { useMessagesOnly } from "@/features/sessions/transcript/useMessagesOnly";
import { openPageEditor, pageAvailability } from "@/features/settings/pageEditor";
import { ShareSessionDialog, type ShareTarget } from "@/features/sharing/ShareSessionDialog";
import { copyText } from "@/shared/components/CopyButton";
import { FormDialog } from "@/shared/components/FormDialog";
import { DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/PianoDialog";
import { DropdownMenuItem } from "@/shared/components/PianoDropdownMenu";
import { RemovalDialog } from "@/shared/components/RemovalDialog";
import { type FocusReturn, focusReturn } from "@/shared/lib/focusReturn";
import { useCodeWrap } from "@/shared/lib/useCodeWrap";
import type { SendDisposition } from "@/shared/transport/ws";

async function copySessionValue(value: string, label: string) {
  const failure = `Could not copy the ${label[0]?.toLowerCase()}${label.slice(1)}.`;
  if (await copyText(value, failure)) toast.success(`${label} copied`);
}

const SESSION_MENU = "main header [data-session-menu]";

function formFocusFallback(form: CommandForm) {
  if (form.kind === "project") return '[data-command="new-project"]';
  if (form.kind === "project-settings" || form.kind === "delete-project")
    return "main header [data-project-menu]";
  return SESSION_MENU;
}

const ICONS: Record<SessionCommandIcon, LucideIcon> = {
  copy: CopyIcon,
  changes: FileDiffIcon,
  wrap: WrapTextIcon,
  artifacts: ShapesIcon,
  list: ListIcon,
  agent: MessagesSquareIcon,
  "pull-request": GitPullRequestIcon,
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
  return <Icon />;
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
  const { state, run, messagesOnly, codeWrap, layout } = useCommands();
  return {
    commands: sessionCommands(state, target, { messagesOnly, codeWrap, layout }),
    run,
    messagesOnly,
  };
}

export function useSessionProjectMenu() {
  const { state } = useCommands();
  const session = state.session;
  return session?.sessionId
    ? sessionProjectMenu(state, { cwd: session.cwd, sessionId: session.sessionId })
    : undefined;
}

export function useGlobalCommands() {
  const { state, run, global } = useCommands();
  return { commands: globalCommands(state, global), run };
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
      onClick={() => run(command)}
    >
      <CommandIcon icon={command.icon} /> {command.label}
    </DropdownMenuItem>
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
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const returnFocus = useRef<FocusReturn | undefined>(undefined);

  const effects: CommandEffects = {
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
      returnFocus.current = focusReturn(formFocusFallback(form));
      forms.open(form);
    },
    shareSession: (target) => {
      const workspace = workspaceFor(state, target.cwd);
      if (!workspace) {
        toast.error("Could not find this session’s workspace. Refresh the session list.");
        return;
      }
      returnFocus.current = focusReturn(SESSION_MENU);
      setSharing({
        workspaceId: workspace.id,
        sessionId: target.sessionId,
        title: sessionLabel(target.title),
      });
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
          openSettings={openSettings}
          finalFocus={returnFocus.current}
        />
      )}
      <FormDialog
        open={!!renaming}
        close={close}
        className="sm:max-w-md"
        initialFocus={renameInputRef}
        finalFocus={returnFocus.current}
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
        finalFocus={returnFocus.current}
      />
      <ProjectDialogView
        open={!!project}
        dialog={project}
        draft={forms.projectDraft}
        setDraft={forms.editProject}
        allowed={answer.allowed}
        submit={forms.submit}
        close={close}
        finalFocus={returnFocus.current}
      />
      <ProjectSettingsDialog
        open={projectSettings}
        check={answer.projectCheck}
        draft={forms.projectDraft}
        setDraft={forms.editProject}
        allowed={answer.allowed}
        submit={forms.submit}
        close={close}
        finalFocus={returnFocus.current}
      />
    </CommandsContext.Provider>
  );
}
