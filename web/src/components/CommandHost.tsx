import type { ClientCommand } from "@shared/wire";
import {
  ArchiveIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  InfoIcon,
  type LucideIcon,
  MessageSquareIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  ShareIcon,
  SquareIcon,
  TextCursorInputIcon,
  Trash2Icon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { createContext, useContext, useRef } from "react";
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
import { PreviewDetails } from "@/components/PreviewDetails";
import { ProjectDialogView } from "@/components/Projects";
import { ShareSessionDialog } from "@/components/ShareSessionDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { confirmation } from "@/lib/commandForms";
import { type Command, type CommandEffects, runCommand } from "@/lib/commands";
import { type GlobalCommandContext, globalCommands } from "@/lib/globalCommands";
import { sessionProjectMenu } from "@/lib/projectCommands";
import { signedInToRadius } from "@/lib/providerAccounts";
import {
  type SessionCommand,
  type SessionCommandIcon,
  type SessionTarget,
  sessionCommands,
} from "@/lib/sessionCommands";
import { useChangesWrap } from "@/lib/useChangesWrap";
import { useCommandForms } from "@/lib/useCommandForms";
import { useMessagesOnly } from "@/lib/useMessagesOnly";
import { useNavigation } from "@/lib/useNavigation";
import { useProviderAccounts } from "@/lib/useProviderAccounts";
import { useSidebarLayout } from "@/lib/useSidebarLayout";
import { useSidebarView } from "@/lib/useSidebarView";
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
  external: ExternalLinkIcon,
  "preview-details": InfoIcon,
  "stop-preview": SquareIcon,
  copy: CopyIcon,
  changes: FileDiffIcon,
  "pull-request": GitPullRequestIcon,
  messages: MessageSquareIcon,
  rename: TextCursorInputIcon,
  pin: PinIcon,
  unpin: PinOffIcon,
  share: ShareIcon,
  archive: ArchiveIcon,
  delete: Trash2Icon,
  new: PlusIcon,
};

export function CommandIcon({ icon }: { icon: SessionCommandIcon }) {
  const Icon = ICONS[icon];
  return <Icon />;
}

interface CommandsValue {
  run: (command: Command) => void;
  messagesOnly: boolean;
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
  const { state, run, messagesOnly, changesWrap, radiusSignedIn } = useCommands();
  return {
    commands: sessionCommands(state, target, { messagesOnly, changesWrap, radiusSignedIn }),
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
 * folder, Share and project dialog. The forms (`useCommandForms`) own submitting; the dialogs only render.
 */
export function CommandHost({
  state,
  send,
  children,
}: {
  state: AppState;
  send: (command: ClientCommand) => void;
  children: React.ReactNode;
}) {
  const { openNew, openProject, openPanel, openSettings, closeSettings, settings } =
    useNavigation();
  const [messagesOnly, setMessagesOnly] = useMessagesOnly();
  const [changesWrap, setChangesWrap] = useChangesWrap();
  const radiusSignedIn = signedInToRadius(useProviderAccounts(), state.connected);
  const { view, setView } = useSidebarView();
  const { theme, setTheme } = useTheme();
  const sidebar = useSidebarLayout();
  const forms = useCommandForms({
    state,
    radiusSignedIn,
    send,
    openProject: (id) => openNew(undefined, id),
  });
  const { form } = forms;
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renaming = form?.kind === "rename-session" ? form.target : null;
  const close = forms.cancel;
  const answer = forms.answer();
  // Archive, delete and close folder share one confirm dialog; `confirmation` decides its wording.
  const asking = form ? confirmation(state, form) : undefined;
  const sharing = form?.kind === "share-session";
  const project = form?.kind === "project" ? form.dialog : undefined;

  const effects: CommandEffects = {
    send,
    closeSettings,
    openSettings,
    openNew,
    openProject,
    openPanel,
    toggleSidebar: sidebar.toggle,
    setView,
    setMessagesOnly,
    setChangesWrap,
    setAppearance: setTheme,
    copy: (value, label) => void copySessionValue(value, label),
    openForm: forms.open,
    openExternal: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
  const run = (command: Command) => {
    runCommand(command, effects);
  };

  return (
    <CommandsContext.Provider
      value={{
        run,
        messagesOnly,
        changesWrap,
        state,
        radiusSignedIn,
        // The one global command context; "system" is next-themes' default before it reads storage.
        global: { settingsOpen: !!settings, view, theme: theme ?? "system" },
      }}
    >
      {children}
      <PreviewDetails
        preview={
          form?.kind === "preview-details" &&
          form.selectionId === state.selectionId &&
          state.session?.hosted &&
          !state.session.state.closure
            ? state.session.state.preview
            : null
        }
        close={close}
        refresh={() => {
          if (form?.kind === "preview-details" && form.selectionId === state.selectionId)
            send({ _tag: "act", action: { _tag: "preview_refresh", details: true } });
        }}
      />
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
              <DialogDescription>
                Pi records the name with the session, so it also appears in Pi's own session list.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <Input
                  ref={renameInputRef}
                  aria-label="Session name"
                  value={renaming ? forms.text : ""}
                  onChange={(event) => forms.edit(event.target.value)}
                  onFocus={(event) => event.target.select()}
                  maxLength={200}
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
      <ProjectDialogView
        open={!!project}
        dialog={project}
        name={forms.text}
        allowed={answer.allowed}
        edit={forms.edit}
        submit={forms.submit}
        close={close}
      />
    </CommandsContext.Provider>
  );
}
