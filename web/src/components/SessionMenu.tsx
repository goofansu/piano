import { useRef, useState } from "react";
import { ArchiveIcon, FileDiffIcon, ListChecksIcon, MenuIcon, Trash2Icon } from "lucide-react";
import type { ClientCommand, WorktreeView } from "@shared/wire";
import type { SessionView } from "@/store";
import { cn } from "cn";
import { formatTokenCount } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WorkspaceChangesDialog } from "@/components/WorkspaceChanges";
import { WorkspaceChecksDialog } from "@/components/WorkspaceChecks";
import type { TranscriptView } from "@/components/MessageList";

/** Keyed by session at the caller: a selection change closes old menus/confirmations.
 * Facts come from the selected session, never catalog defaults or another cwd.
 */
export function SessionMenu({ session, title, projectName, worktree, status, connected, view, onViewChange, send }: {
  session: SessionView; title: string; projectName?: string; worktree?: WorktreeView;
  status: { word: string; dot: string; why: string }; connected: boolean;
  view: TranscriptView; onViewChange: (view: TranscriptView) => void; send: (message: ClientCommand) => void;
}) {
  const [dialog, setDialog] = useState<"changes" | "checks" | "delete" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingDialog = useRef(false);
  const openDialog = (next: "changes" | "checks" | "delete") => { pendingDialog.current = true; setDialog(next); };
  const returnFocus = (event: Event) => { event.preventDefault(); pendingDialog.current = false; trigger.current?.focus(); };
  const canAct = connected && session.sessionId !== null;
  const branch = worktree?.branch ?? (worktree?.facts?.detached ? "Detached HEAD" : worktree?.status === "non-git" ? "Non-Git" : "Unknown branch");
  const info = session.state;
  const context = info.context?.tokens;
  const contextIsLastKnown = !connected || !session.hosted || info.contextIsLastKnown !== false;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon-sm" className="-mr-2" aria-label="Session menu"><MenuIcon /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} aria-label="Session actions and information"
        className="w-80 max-w-[calc(100vw-1rem)]"
        onCloseAutoFocus={event => { if (pendingDialog.current) event.preventDefault(); }}>
        <section aria-label="Session information" className="space-y-3 px-2.5 py-3 text-sm select-text">
          <div className="space-y-1">
            <h2 className="break-words font-medium">{title}</h2>
            <p title={status.why} className="flex items-center gap-2 text-xs text-ink-2"><span className={cn("size-2 shrink-0 rounded-full", status.dot)} aria-hidden />{status.word}</p>
          </div>
          <div className="space-y-1">
            <p className="break-words text-xs text-ink-2">{projectName && <>{projectName} · </>}<span className="font-mono">{branch}</span></p>
            <p className="break-all font-mono text-xs text-ink-3">{session.cwd}</p>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-ink-3">Session model</dt><dd className="break-all text-right">{info.model ?? "Not recorded"}</dd>
            <dt className="text-ink-3">Effort</dt><dd className="text-right">{info.thinkingLevel ?? "Not recorded"}</dd>
            <dt className="text-ink-3">Context</dt><dd className="text-right tabular-nums">{context == null ? "Unavailable" : `${formatTokenCount(context)} tokens${contextIsLastKnown ? " · last-known" : ""}`}</dd>
            {info.tokens && <><dt className="text-ink-3">Session tokens</dt><dd className="text-right tabular-nums">{formatTokenCount(info.tokens.total)}</dd></>}
            <dt className="text-ink-3">Session cost</dt><dd className="text-right tabular-nums">{info.cost === undefined ? "Unavailable" : `$${info.cost.toFixed(2)}`}</dd>
          </dl>
          <p className="break-all text-xs text-ink-3">Session ID <span className="font-mono">{session.sessionId}</span></p>
        </section>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!worktree} onSelect={() => openDialog("changes")}><FileDiffIcon /> Changes</DropdownMenuItem>
        <DropdownMenuItem disabled={!worktree} onSelect={() => openDialog("checks")}><ListChecksIcon /> Checks</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={view === "replies"} onCheckedChange={checked => onViewChange(checked ? "replies" : "all")}>
          End-of-turn messages only
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canAct} onSelect={() => { if (canAct) send({ _tag: "archive_session", cwd: session.cwd, sessionId: session.sessionId! }); }}>
          <ArchiveIcon /> Archive session
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={!canAct} onSelect={() => openDialog("delete")}><Trash2Icon /> Delete session…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {worktree && <WorkspaceChangesDialog workspace={worktree.workspace} open={dialog === "changes"}
      onOpenChange={open => { if (!open) setDialog(null); }} onCloseAutoFocus={returnFocus} />}
    {worktree && <WorkspaceChecksDialog workspace={worktree.workspace} open={dialog === "checks"}
      onOpenChange={open => { if (!open) setDialog(null); }} onCloseAutoFocus={returnFocus} />}
    <Dialog open={dialog === "delete"} onOpenChange={open => { if (!open) setDialog(null); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Delete this session?</DialogTitle>
          <DialogDescription className="break-words">“{title}” and its transcript are removed from Pi's session store. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="destructive" disabled={!canAct} onClick={() => {
            if (canAct) { send({ _tag: "delete_session", cwd: session.cwd, sessionId: session.sessionId! }); setDialog(null); }
          }}>Delete session</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
