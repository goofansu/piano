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
  ShareIcon,
  SquareIcon,
  SquarePenIcon,
  TextCursorInputIcon,
  Trash2Icon,
  WrapTextIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { createContext, useContext, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { copyText } from "@/components/CopyButton";
import { FormDialog } from "@/components/FormDialog";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/PianoDialog";
import { DropdownMenuItem } from "@/components/PianoDropdownMenu";
import { ProjectDialogView } from "@/components/Projects";
import { ProjectSettingsDialog } from "@/components/ProjectSettings";
import { RemovalDialog } from "@/components/RemovalDialog";
import { PreviewDetailsDialog } from "@/components/SessionPreview";
import { ShareSessionDialog } from "@/components/ShareSessionDialog";
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
import { previewObservation } from "@/lib/previewObservation";
import { sessionProjectMenu } from "@/lib/projectCommands";
import { signedInToRadius } from "@/lib/providerAccounts";
import {
  type SessionCommand,
  type SessionCommandIcon,
  type SessionTarget,
  sessionCommands,
} from "@/lib/sessionCommands";
import { type PreviewClaim, previewClaim } from "@/lib/sessionPreview";
import { useCodeWrap } from "@/lib/useCodeWrap";
import { useCommandForms } from "@/lib/useCommandForms";
import { useMessagesOnly } from "@/lib/useMessagesOnly";
import { useNavigation } from "@/lib/useNavigation";
import { useProviderAccounts } from "@/lib/useProviderAccounts";
import { useSidebarLayout } from "@/lib/useSidebarLayout";
import { useSidebarView } from "@/lib/useSidebarView";
import type { SendDisposition } from "@/lib/ws";
import type { AppState } from "@/store";

async function copySessionValue(value: string, label: string) {
  const failure = `Could not copy the ${label[0]?.toLowerCase()}${label.slice(1)}.`;
  if (await copyText(value, failure)) toast.success(`${label} copied`);
}

/** A menu row disappears on handoff; return keyboard focus to its surviving trigger. */
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
  pin: PinIcon,
  unpin: PinOffIcon,
  share: ShareIcon,
  archive: ArchiveIcon,
  delete: Trash2Icon,
  new: SquarePenIcon,
};

export function CommandIcon({ icon }: { icon: SessionCommandIcon }) {
  const Icon = ICONS[icon];
  // Stop is the filled square the composer's Stop shows; hollow, it reads as a checkbox.
  return <Icon className={icon === "stop" ? "fill-current" : undefined} />;
}

interface CommandsValue {
  run: (command: Command) => void;
  messagesOnly: boolean;
  layout: SessionLayout;
  codeWrap: boolean;
  state: AppState;
  radiusSignedIn: boolean;
  global: GlobalCommandContext;
}
const CommandsContext = createContext<CommandsValue | null>(null);

/** The host's runner: every surface hands its global, project, folder and session commands here. */
export function useCommands() {
  const value = useContext(CommandsContext);
  if (!value) throw new Error("useCommands needs a CommandHost");
  return value;
}

/** Session commands for `target`, or for the selected session, with the host's runner. */
export function useSessionCommands(target?: SessionTarget) {
  const { state, run, messagesOnly, codeWrap, radiusSignedIn, layout } = useCommands();
  const observed = useSyncExternalStore(previewObservation.subscribe, previewObservation.getState);
  return {
    commands: sessionCommands(state, target, {
      messagesOnly,
      codeWrap,
      radiusSignedIn,
      layout,
      previewObservation: observed,
    }),
    run,
    messagesOnly,
  };
}

/**
 * The selected session's project membership (`sessionProjectMenu`), for the header's phone sheet
 * and the palette; none until the session has a Pi session ID.
 */
export function useSessionProjectMenu() {
  const { state } = useCommands();
  const session = state.session;
  return session?.sessionId
    ? sessionProjectMenu(state, { cwd: session.cwd, sessionId: session.sessionId })
    : undefined;
}

/**
 * Global commands with the host's runner, from one context: whether Settings is open, the sidebar's
 * view and the chosen appearance. The palette and the sidebar's View menu both list these, so each
 * marks the same choices current.
 */
export function useGlobalCommands() {
  const { state, run, global } = useCommands();
  return { commands: globalCommands(state, global), run };
}

/** A descriptor as a menu row, by its label and icon. */
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

/**
 * The one owner of command effects and their forms: whichever surface asked, running a command goes
 * through `runCommand`, which refuses a disabled one, and there is a single Rename, Archive, Delete, Close
 * folder, Share, New project and Project settings dialog. The forms (`useCommandForms`) own submitting; the dialogs only render.
 */
export function CommandHost({
  state,
  send,
  listen,
  children,
}: {
  state: AppState;
  send: (command: ClientCommand) => SendDisposition;
  /** Hears each server frame, as `Client.listen` does. */
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
  const radiusSignedIn = signedInToRadius(useProviderAccounts(), state.connected);
  const { view, setView } = useSidebarView();
  const { theme, setTheme } = useTheme();
  const sidebar = useSidebarLayout();
  // Out of sight: the desktop column collapsed, or below the breakpoint the sheet closed. A boolean
  // snapshot, so a resize drag does not re-render the host.
  const sidebarHidden = useSyncExternalStore(sidebar.subscribe, () =>
    sidebar.desktop() ? sidebar.getState().collapsed : !sidebar.getState().mobileOpen,
  );
  // A page reporting its creation unavailable changes `pageCommands`, so every surface re-renders.
  useSyncExternalStore(pageAvailability.subscribe, pageAvailability.getState);
  const forms = useCommandForms({
    state,
    radiusSignedIn,
    // A form known not sent stays open with its input; say why, as the composer does.
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
  // Archive, delete, close folder and delete project share one confirm dialog; `confirmation` decides its wording.
  // The dialog animates closed on a copy of its last open face (useExitFace), so it needs no latch.
  const asking = form ? confirmation(state, form) : undefined;
  const sharing = form?.kind === "share-session";
  const project = form?.kind === "project" ? form.dialog : undefined;
  const projectSettings = form?.kind === "project-settings";
  // The app whose details are open; another app, even in the same session, never reopens them.
  const [previewDetails, setPreviewDetails] = useState<PreviewClaim | null>(null);
  const detailsFocus = useRef<((event: Event) => void) | undefined>(undefined);
  const stopFocus = useRef<((event: Event) => void) | undefined>(undefined);

  const effects: CommandEffects = {
    send,
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
      if (form.kind === "stop-preview") previewObservation.refresh();
    },
    openUrl: openLink,
    openPreviewDetails: () => {
      detailsFocus.current = previewFocusReturn();
      setPreviewDetails(previewClaim(state) ?? null);
      previewObservation.refresh();
    },
    openPageEditor,
  };
  const run = (command: Command) => {
    runCommand(command, effects);
  };

  return (
    <CommandsContext.Provider
      value={{
        run,
        messagesOnly,
        layout,
        codeWrap,
        state,
        radiusSignedIn,
        // The one global command context; "system" is next-themes' default before it reads storage.
        global: { settings, view, theme: theme ?? "system", sidebarHidden },
      }}
    >
      {children}
      <ShareSessionDialog
        open={sharing}
        phase={forms.share}
        allowed={answer.allowed}
        signedIn={radiusSignedIn}
        submit={forms.submit}
        close={close}
      />
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
        // Sending closes the form at once, so there is no wait to show.
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
