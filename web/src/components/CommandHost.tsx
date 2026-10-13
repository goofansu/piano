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
import { ProjectDialogView } from "@/components/Projects";
import { ShareSessionDialog } from "@/components/ShareSessionDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { answerForm } from "@/lib/commandForms";
import { type Command, type CommandEffects, type CommandForm, runCommand } from "@/lib/commands";
import {
  type SessionCommand,
  type SessionCommandIcon,
  type SessionDisplay,
  type SessionTarget,
  sessionCommands,
} from "@/lib/sessionCommands";
import { useNavigation } from "@/lib/useNavigation";
import { useRadiusSignedIn } from "@/lib/useRadiusSignedIn";
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
 * through `runCommand`, which refuses a disabled one, and there is a single Rename, Delete, Close
 * folder and project dialog. Each form re-checks its rule when it is answered.
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
  const { openNew, openPanel, openSettings, closeSettings } = useNavigation();
  const [display, setDisplay] = useSessionDisplay();
  const radiusSignedIn = useRadiusSignedIn(state.connected);
  const { setView } = useSidebarView();
  const { setTheme } = useTheme();
  const sidebar = useSidebarLayout();
  const [form, setForm] = useState<CommandForm | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renaming = form?.kind === "rename-session" ? form.target : null;
  const deleting = form?.kind === "delete-session" ? form.target : null;
  const closing = form?.kind === "close-folder" ? form.folder : null;
  const close = () => setForm(null);
  // Forms re-check the rule when they are answered: the attachment or connection may have changed since.
  const answer = form && form.kind !== "project" ? answerForm(state, form, draftTitle) : null;
  /** Send the open form's answer, if it is allowed now. */
  const submit = () => {
    if (answer?.command) send(answer.command);
    return !!answer?.allowed;
  };

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
    openForm: (next) => {
      if (next.kind === "rename-session") setDraftTitle(next.target.title ?? "");
      setForm(next);
    },
  };
  const run = (command: Command) => {
    runCommand(command, effects);
  };

  return (
    <CommandsContext.Provider value={{ run, display, state, radiusSignedIn }}>
      {children}
      {form?.kind === "share-session" && (
        <ShareSessionDialog
          key={JSON.stringify(form.target)}
          target={form.target}
          state={state}
          signedIn={radiusSignedIn}
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
              if (submit()) close();
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
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onFocus={(event) => event.target.select()}
                  maxLength={200}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={!answer?.allowed}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!deleting} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              "{deleting?.title || "Untitled"}" and its transcript are removed from Pi's session
              store. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!answer?.allowed}
              onClick={() => {
                submit();
                close();
              }}
            >
              Delete
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
            <Button
              disabled={!answer?.allowed}
              onClick={() => {
                if (submit()) close();
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {form?.kind === "project" && (
        <ProjectDialogView
          key={JSON.stringify(form.dialog)}
          state={state}
          send={send}
          dialog={form.dialog}
          close={close}
          openProject={(id) => openNew(undefined, id)}
        />
      )}
    </CommandsContext.Provider>
  );
}
