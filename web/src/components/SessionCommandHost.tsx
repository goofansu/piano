import type { ClientCommand } from "@shared/wire";
import { ArchiveIcon, CopyIcon, FileDiffIcon, GitPullRequestIcon, ListIcon, type LucideIcon, MessageSquareIcon, PlusIcon, TextCursorInputIcon, Trash2Icon } from "lucide-react";
import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type SessionCommand, type SessionCommandIcon, type SessionDisplay, type SessionTarget, sessionCommands } from "@/lib/sessionCommands";
import { sessionCheckoutMissing, sessionMutable } from "@/lib/sessionContext";
import { useNavigation } from "@/lib/useNavigation";
import { useSessionDisplay } from "@/lib/useSessionDisplay";
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
  copy: CopyIcon, changes: FileDiffIcon, "pull-request": GitPullRequestIcon, everything: ListIcon, messages: MessageSquareIcon,
  rename: TextCursorInputIcon, archive: ArchiveIcon, delete: Trash2Icon, new: PlusIcon,
};

export function CommandIcon({ icon }: { icon: SessionCommandIcon }) {
  const Icon = ICONS[icon];
  return <Icon />;
}

interface SessionCommandsValue { run: (command: SessionCommand) => void; display: SessionDisplay; state: AppState }
const SessionCommandsContext = createContext<SessionCommandsValue | null>(null);

/**
 * Session commands for `target`, or for the selected session, and the runner that carries them out.
 * Every surface goes through here, so a command means the same thing wherever it is offered.
 */
export function useSessionCommands(target?: SessionTarget) {
  const value = useContext(SessionCommandsContext);
  if (!value) throw new Error("useSessionCommands needs a SessionCommandHost");
  return { commands: sessionCommands(value.state, target, { display: value.display }), run: value.run, display: value.display };
}

/** A descriptor as a menu row, by its label and icon. */
export function SessionCommandMenuItem({ command, run }: { command: SessionCommand; run: (command: SessionCommand) => void }) {
  return (
    <DropdownMenuItem variant={command.group === "destructive" ? "destructive" : undefined} disabled={!command.enabled} onSelect={() => run(command)}>
      <CommandIcon icon={command.icon} /> {command.label}
    </DropdownMenuItem>
  );
}

/**
 * The one owner of session command effects and their confirmations: a single Rename dialog and a
 * single Delete dialog, whichever surface asked for them.
 */
export function SessionCommandHost({ state, send, children }: { state: AppState; send: (command: ClientCommand) => void; children: React.ReactNode }) {
  const { openNew, openPanel } = useNavigation();
  const [display, setDisplay] = useSessionDisplay();
  const [renaming, setRenaming] = useState<SessionTarget | null>(null);
  const [deleting, setDeleting] = useState<SessionTarget | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Confirmations re-check the rule when they are answered: the attachment may have changed since.
  const canRename = !!renaming && sessionMutable(state, renaming) && !sessionCheckoutMissing(state, renaming) && !!draftTitle.trim() && draftTitle.trim() !== (renaming.title ?? "");
  const canDelete = !!deleting && sessionMutable(state, deleting);

  const run = (command: SessionCommand) => {
    if (!command.enabled) return;
    const intent = command.intent;
    switch (intent.kind) {
      case "copy": void copySessionValue(intent.value, intent.label); return;
      case "changes": openPanel("changes"); return;
      case "pull-request": openPanel("pr"); return;
      case "display": setDisplay(intent.display); return;
      case "new-session": openNew(intent.cwd); return;
      case "rename": if (intent.target) { setDraftTitle(intent.target.title ?? ""); setRenaming(intent.target); } return;
      case "delete": if (intent.target) setDeleting(intent.target); return;
      case "archive": {
        const t = intent.target;
        if (t && sessionMutable(state, t)) send({ _tag: "archive_session", cwd: t.cwd, sessionId: t.sessionId });
        return;
      }
    }
  };

  return <SessionCommandsContext.Provider value={{ run, display, state }}>
    {children}
    <Dialog open={!!renaming} onOpenChange={open => !open && setRenaming(null)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); renameInputRef.current?.focus(); }}>
        <form onSubmit={event => {
          event.preventDefault();
          if (!renaming || !canRename) return;
          send({ _tag: "rename_session", cwd: renaming.cwd, sessionId: renaming.sessionId, title: draftTitle.trim() });
          setRenaming(null);
        }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>Pi records the name with the session, so it also appears in Pi's own session list.</DialogDescription>
          </DialogHeader>
          <FieldGroup><Field><Input ref={renameInputRef} aria-label="Session name" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} onFocus={event => event.target.select()} maxLength={200} /></Field></FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button type="submit" disabled={!canRename}>Rename</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete this session?</DialogTitle>
          <DialogDescription>"{deleting?.title || "Untitled"}" and its transcript are removed from Pi's session store. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" disabled={!canDelete} onClick={() => {
            if (deleting && canDelete) send({ _tag: "delete_session", cwd: deleting.cwd, sessionId: deleting.sessionId });
            setDeleting(null);
          }}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </SessionCommandsContext.Provider>;
}
