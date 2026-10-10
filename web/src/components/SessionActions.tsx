import type { ClientCommand } from "@shared/wire";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { sessionContext } from "@/lib/sessionContext";
import type { AppState } from "@/store";

type Target = { cwd: string; sessionId: string; title?: string };

export async function copySessionValue(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn’t copy ${label.toLowerCase()}.`);
  }
}

/** Copy the working directory and available session ID shown in the details menu. */
export function copyAllSessionDetails(state: AppState) {
  if (!state.session) return;
  const { sessionId } = sessionContext(state);
  const lines = [
    `Working directory: ${state.session.cwd}`,
    ...(sessionId ? [`Session ID: ${sessionId}`] : []),
  ];
  return copySessionValue(lines.join("\n"), "Session details");
}

/** Shared confirmations keep sidebar, header and palette actions identical. */
export function useSessionActions(send: (command: ClientCommand) => void, enabled: boolean) {
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const canRename = enabled && !!renaming && !!draftTitle.trim() && draftTitle.trim() !== (renaming.title ?? "");
  const rename = (target: Target) => { setDraftTitle(target.title ?? ""); setRenaming(target); };
  const archive = (target: Target) => { if (enabled) send({ _tag: "archive_session", cwd: target.cwd, sessionId: target.sessionId }); };
  const dialogs = <>
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
          <Button variant="destructive" disabled={!enabled} onClick={() => {
            if (deleting && enabled) send({ _tag: "delete_session", cwd: deleting.cwd, sessionId: deleting.sessionId });
            setDeleting(null);
          }}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
  return { rename, archive, delete: setDeleting, dialogs };
}
