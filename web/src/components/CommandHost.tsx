import type { ClientCommand } from "@shared/wire";
import {
  ArchiveIcon,
  CopyIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  ListIcon,
  type LucideIcon,
  MessageSquareIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  ShareIcon,
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
import { ProjectDialogView } from "@/components/Projects";
import { ShareSessionDialog } from "@/components/ShareSessionDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type Command, type CommandEffects, runCommand } from "@/lib/commands";
import { type GlobalCommandContext, globalCommands } from "@/lib/globalCommands";
import { signedInToRadius } from "@/lib/providerAccounts";
import {
  type SessionCommand,
  type SessionCommandIcon,
  type SessionDisplay,
  type SessionTarget,
  sessionCommands,
} from "@/lib/sessionCommands";
import { sessionWorking } from "@/lib/sessionContext";
import { useCommandForms } from "@/lib/useCommandForms";
import { useNavigation } from "@/lib/useNavigation";
import { useProviderAccounts } from "@/lib/useProviderAccounts";
import { useSessionDisplay } from "@/lib/useSessionDisplay";
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
  copy: CopyIcon,
  changes: FileDiffIcon,
  "pull-request": GitPullRequestIcon,
  everything: ListIcon,
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
  display: SessionDisplay;
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
  const { state, run, display, radiusSignedIn } = useCommands();
  return { commands: sessionCommands(state, target, { display, radiusSignedIn }), run, display };
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
      variant={command.group === "destructive" ? "destructive" : undefined}
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
  const { openNew, openPanel, openSettings, closeSettings, settings } = useNavigation();
  const [display, setDisplay] = useSessionDisplay();
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
  const deleting = form?.kind === "delete-session" ? form.target : null;
  const archiving = form?.kind === "archive-session" ? form.target : null;
  const deletingWorking = !!deleting && sessionWorking(state, deleting);
  const closing = form?.kind === "close-folder" ? form.folder : null;
  const close = forms.cancel;
  const answer = forms.answer();

  const effects: CommandEffects = {
    send,
    closeSettings,
    openSettings,
    openNew,
    openPanel,
    toggleSidebar: sidebar.toggle,
    setView,
    setDisplay,
    setAppearance: setTheme,
    copy: (value, label) => void copySessionValue(value, label),
    openForm: forms.open,
  };
  const run = (command: Command) => {
    runCommand(command, effects);
  };

  return (
    <CommandsContext.Provider
      value={{
        run,
        display,
        state,
        radiusSignedIn,
        // The one global command context; "system" is next-themes' default before it reads storage.
        global: { settingsOpen: !!settings, view, theme: theme ?? "system" },
      }}
    >
      {children}
      {form?.kind === "share-session" && (
        <ShareSessionDialog
          phase={forms.share}
          allowed={answer.allowed}
          signedIn={radiusSignedIn}
          submit={forms.submit}
          close={close}
        />
      )}
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
                  value={forms.text}
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
      <Dialog open={!!archiving} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Stop and archive this session?</DialogTitle>
            <DialogDescription>
              This will stop any work still running in "{archiving?.title || "Untitled"}" and remove
              it from the sidebar. Its transcript will be kept. Changes already made to files will
              not be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={!answer.allowed} onClick={forms.submit}>
              Stop and archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!deleting} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              {deletingWorking && "This will stop the session and interrupt its current work. "}"
              {deleting?.title || "Untitled"}" and its transcript are removed from Pi's session
              store. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!answer.allowed} onClick={forms.submit}>
              {deletingWorking ? "Stop and delete" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!closing} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Close this folder?</DialogTitle>
            <DialogDescription>
              "{closing?.name}" will be removed from the sidebar. Files and session history will not
              be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={!answer.allowed} onClick={forms.submit}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {form?.kind === "project" && (
        <ProjectDialogView
          dialog={form.dialog}
          name={forms.text}
          allowed={answer.allowed}
          edit={forms.edit}
          submit={forms.submit}
          close={close}
        />
      )}
    </CommandsContext.Provider>
  );
}
