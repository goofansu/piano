import { useEffect, useRef, useState } from "react";
import type { ClientCommand, WorktreeFacts } from "@shared/wire";
import type { AppState } from "@/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function worktreeStatus(w: WorktreeFacts): string {
  const c = w.changes;
  const flags = c ? [c.staged && "Staged", c.modified && "Modified", c.untracked && "Untracked", c.renamed && "Renamed", c.deleted && "Deleted", c.conflicted && "Conflicts", c.conflicted === null && "Conflicts unknown"].filter(Boolean) : [];
  return [w.detached && "Detached", !w.head && "No HEAD", c ? (flags.join(" · ") || "Clean") : "Changes unknown",
    w.operation === null ? "Operation unknown" : w.operation && `${w.operation.replaceAll("_", " ")} in progress`,
    w.locked === null ? "Lock unknown" : w.locked && "Locked", w.prunable === null ? "Availability unknown" : w.prunable && "Prunable",
  ].filter(Boolean).join(" · ");
}

/** One deliberate discovery/selection or new-branch operation; never automatic retries. */
export function WorktreesDialog({ open, onOpenChange, state, currentCwd, send, onSelect }: {
  open: boolean; onOpenChange: (o: boolean) => void; state: AppState; currentCwd: string;
  send: (m: ClientCommand) => void; onSelect: (cwd: string) => void;
}) {
  const owner = state.projects.find(p => p.worktrees.some(w => w.path === currentCwd))?.path ?? state.projects[0]?.path ?? "";
  const [project, setProject] = useState(owner);
  const [branch, setBranch] = useState("");
  const [hooks, setHooks] = useState(false);
  const [request, setRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const [refreshing, setRefreshing] = useState(false);
  const p = state.projects.find(p => p.path === project);
  const discovery = p?.discovery;
  const pending = request !== null;
  useEffect(() => {
    if (!open) return;
    setProject(owner); setError(null); setRequest(null); setRefreshing(true);
    send({ _tag: "projects" });
  }, [open, owner, send]);
  useEffect(() => setRefreshing(false), [state.projects]);
  useEffect(() => {
    if (!request || state.worktreeResult?.requestId !== request) return;
    const result = state.worktreeResult.result;
    setRequest(null);
    if (result.status === "error") { setError(result.detail); return; }
    setBranch(""); onSelect(result.path); onOpenChange(false);
  }, [state.worktreeResult, request, onSelect, onOpenChange]);
  useEffect(() => {
    if (!open || !pending) return;
    // A disconnected client has no durable job receipt. Never resend automatically.
    const timer = setTimeout(() => { setRequest(null); setError("No creation/selection receipt. Refresh discovery and inspect the checkout before retrying; it may already exist."); }, 75_000);
    if (!state.connected) { setRequest(null); setError("Connection lost. Refresh discovery after reconnecting before retrying; the operation may have changed the checkout."); }
    return () => clearTimeout(timer);
  }, [open, pending, state.connected]);
  const submit = () => {
    if (pending || !state.connected || !branch.trim() || discovery?.status !== "ready") return;
    const requestId = crypto.randomUUID(); setRequest(requestId); setError(null);
    send({ _tag: "create_worktree", requestId, project, branch: branch.trim(), hooks });
  };
  return <Dialog open={open} onOpenChange={o => { if (!pending) onOpenChange(o); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Worktrees</DialogTitle>
        <DialogDescription>Select a discovered checkout or create a new branch. Sessions are added only when you start them.</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-2">
        <Select value={project} onValueChange={setProject} disabled={pending}>
          <SelectTrigger aria-label="Worktree project" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>{state.projects.map(p => <SelectItem key={p.path} value={p.path}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" disabled={pending || !state.connected || refreshing} onClick={() => { setRefreshing(true); send({ _tag: "projects" }); }}>Refresh</Button>
      </div>
      {!state.connected && <p className="text-sm text-ink-3">Disconnected — showing last observation.</p>}
      {refreshing && <p role="status" className="text-sm text-ink-3">Refreshing — showing last observation.</p>}
      {discovery?.status === "error" && <div role="alert" className="whitespace-pre-wrap break-words text-sm text-err">{discovery.detail}</div>}
      {discovery?.status === "non-git" && <p className="text-sm text-ink-2">Non-Git directory. Chat is available; worktree creation is not.</p>}
      {discovery?.status === "ready" && <>
        <ul className="space-y-2" aria-label="Discovered worktrees">
          {discovery.worktrees.map(w => <li key={w.path} className="rounded-md border border-line p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{w.branch ?? "Detached HEAD"}</span>
              <Button size="sm" variant="outline" disabled={pending || !state.connected || refreshing || w.prunable !== undefined} onClick={() => {
                const requestId = crypto.randomUUID(); setRequest(requestId); setError(null);
                send({ _tag: "add_worktree", requestId, project, path: w.path });
              }}>Select {w.branch ?? "detached"}</Button>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-ink-3">{w.path}</p>
            <p className="mt-1 text-sm text-ink-2">{worktreeStatus(w)}</p>
            <details className="mt-1 text-xs text-ink-3"><summary className="cursor-pointer">Details</summary>
              <p>HEAD: {w.head ?? "unborn"}</p><p>{w.main ? "Primary checkout" : "Linked checkout"}</p>
              <p>Observed: {discovery.observedAt}</p>
              <p>Default branch: {discovery.defaultBranch === undefined ? "not detected" : discovery.defaultBranch ?? "unknown"}</p>
              {w.locked && <p>Lock: {w.locked.reason ?? "no reason"}</p>}{w.prunable && <p>Prunable: {w.prunable.reason ?? "no reason"}</p>}
            </details>
          </li>)}
        </ul>
        <form className="space-y-3 border-t border-line pt-4" onSubmit={e => { e.preventDefault(); submit(); }}>
          <label htmlFor="wt-branch" className="block text-sm font-medium">New branch</label>
          <Input id="wt-branch" value={branch} disabled={pending} onChange={e => setBranch(e.target.value)} placeholder="feature-name" autoComplete="off" />
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={hooks} disabled={pending} onChange={e => setHooks(e.target.checked)} /> Run approved Worktrunk hooks</label>
          {hooks && <p className="text-xs text-ink-3">Unapproved project hooks block creation. Review and approve them in a terminal first. Background hooks may outlive creation.</p>}
          <Button type="submit" disabled={!branch.trim() || pending || !state.connected || refreshing}>{pending ? "Waiting for Worktrunk…" : "Create worktree"}</Button>
        </form>
      </>}
      {error && <div ref={errorRef} role="alert" className="text-sm text-err">
        <p>Worktree operation not confirmed. Refresh discovery before retrying.</p>
        <p className="mt-1">For unapproved hooks, review and approve them in a terminal, or leave hooks off.</p>
        <details className="mt-2"><summary className="cursor-pointer">Error details</summary><p className="whitespace-pre-wrap break-words">{error}</p></details>
      </div>}
    </DialogContent>
  </Dialog>;
}
