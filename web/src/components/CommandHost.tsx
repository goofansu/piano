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
  ShareIcon,
  SquareIcon,
  SquarePenIcon,
  TextCursorInputIcon,
  Trash2Icon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { DropdownMenuItem } from "@/components/PianoDropdownMenu";
import { ProjectSettingsDialog } from "@/components/ProjectSettings";
import { ProjectDialogView } from "@/components/Projects";
import { PreviewDetailsDialog } from "@/components/SessionPreview";
import { ShareSessionDialog } from "@/components/ShareSessionDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { confirmation, FORM_NOT_SENT } from "@/lib/commandForms";
import { type Command, type CommandEffects, runCommand } from "@/lib/commands";
import { type GlobalCommandContext, globalCommands } from "@/lib/globalCommands";
import type { SessionLayout } from "@/lib/navigation";
import { previewObservation } from "@/lib/previewObservation";
import { sessionProjectMenu } from "@/lib/projectCommands";
import { signedInToRadius } from "@/lib/providerAccounts";
import {
  type SessionCommand,
  type SessionCommandIcon,
  type SessionTarget,
  sessionCommands,
} from "@/lib/sessionCommands";
import { openLink } from "@/lib/sessionLinks";
import { selectedPreview } from "@/lib/sessionPreview";
import { useChangesWrap } from "@/lib/useChangesWrap";
import { useCommandForms } from "@/lib/useCommandForms";
import { useMessagesOnly } from "@/lib/useMessagesOnly";
import { useNavigation } from "@/lib/useNavigation";
import { useProviderAccounts } from "@/lib/useProviderAccounts";
import { useSidebarLayout } from "@/lib/useSidebarLayout";
import { useSidebarView } from "@/lib/useSidebarView";
import { webhookEditor } from "@/lib/useWebhookEditor";
import type { SendDisposition } from "@/lib/ws";
import type { AppState } from "@/store";

async function copySessionValue(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn’t copy ${label.toLowerCase()}.`);
  }
}

const ICONS: Record<SessionCommandIcon, LucideIcon> = {
  copy: CopyIcon,
  changes: FileDiffIcon,
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
  changesWrap: boolean;
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
  const { state, run, messagesOnly, changesWrap, radiusSignedIn, layout } = useCommands();
  return {
    commands: sessionCommands(state, target, { messagesOnly, changesWrap, radiusSignedIn, layout }),
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
    openPreview,
    toggleRail,
    showAgent,
    openPullRequest,
    openSettings,
    closeSettings,
    settings,
    layout,
  } = useNavigation();
  const [messagesOnly, setMessagesOnly] = useMessagesOnly();
  const [changesWrap, setChangesWrap] = useChangesWrap();
  const radiusSignedIn = signedInToRadius(useProviderAccounts(), state.connected);
  const { view, setView } = useSidebarView();
  const { theme, setTheme } = useTheme();
  const sidebar = useSidebarLayout();
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
  const asking = form ? confirmation(state, form) : undefined;
  const sharing = form?.kind === "share-session";
  const project = form?.kind === "project" ? form.dialog : undefined;
  const projectSettings = form?.kind === "project-settings";
  // The app whose details are open; another app, even in the same session, never reopens them.
  const [previewDetails, setPreviewDetails] = useState<{
    instanceId: string;
    selectionId: string | null;
    generation: string | null;
  } | null>(null);

  const effects: CommandEffects = {
    send,
    closeSettings,
    openSettings,
    openNew,
    openProjects,
    openProject,
    openChanges,
    openPreview: () => {
      openPreview();
      previewObservation.refresh();
    },
    toggleRail,
    showAgent,
    openPullRequest,
    toggleSidebar: sidebar.toggle,
    setView,
    setMessagesOnly,
    setChangesWrap,
    setAppearance: setTheme,
    copy: (value, label) => void copySessionValue(value, label),
    openForm: (form) => {
      forms.open(form);
      if (form.kind === "stop-preview") previewObservation.refresh();
    },
    openUrl: openLink,
    openPreviewDetails: () => {
      const preview = selectedPreview(state);
      setPreviewDetails(
        preview
          ? {
              instanceId: preview.instanceId,
              selectionId: state.selectionId,
              generation: state.session?.cursor?.generation ?? null,
            }
          : null,
      );
      previewObservation.refresh();
    },
    addWebhook: () => webhookEditor.open("new"),
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
        changesWrap,
        state,
        radiusSignedIn,
        // The one global command context; "system" is next-themes' default before it reads storage.
        global: { settings, view, theme: theme ?? "system" },
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
      <Dialog open={!!renaming} onOpenChange={(open) => !open && close()}>
        <DialogContent
          className="sm:max-w-md"
          showCloseButton={false}
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
        </DialogContent>
      </Dialog>
      <Dialog open={!!asking} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{asking?.title}</DialogTitle>
            <DialogDescription>{asking?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={asking?.destructive ? "destructive" : "default"}
              disabled={!answer.allowed}
              onClick={forms.submit}
            >
              {asking?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PreviewDetailsDialog
        instanceId={
          previewDetails?.selectionId === state.selectionId &&
          previewDetails?.generation === (state.session?.cursor?.generation ?? null)
            ? (previewDetails?.instanceId ?? null)
            : null
        }
        close={() => setPreviewDetails(null)}
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
        draft={forms.projectDraft}
        setDraft={forms.editProject}
        allowed={answer.allowed}
        submit={forms.submit}
        close={close}
      />
    </CommandsContext.Provider>
  );
}
