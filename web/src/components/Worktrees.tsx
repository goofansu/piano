import { useEffect, useRef, useState } from "react";
import { CheckIcon, LoaderCircleIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import type { ClientCommand } from "@shared/wire";
import type { AppState } from "@/store";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** One deliberate discovery/selection or new-branch operation; never automatic retries. */
export function WorktreesPopover({ onOpenChange, onPendingChange, state, currentCwd, send, onSelect }: {
  onOpenChange: (o: boolean) => void; onPendingChange: (pending: boolean) => void; state: AppState; currentCwd: string;
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
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useEffect(() => {
    setProject(owner); setError(null); setRequest(null); setRefreshing(true);
    send({ _tag: "projects" });
  }, [owner, send]);
  useEffect(() => setRefreshing(false), [state.projects]);
  useEffect(() => {
    if (!request || state.worktreeResult?.requestId !== request) return;
    const result = state.worktreeResult.result;
    setRequest(null);
    if (result.status === "error") { setError(result.detail); return; }
    setBranch(""); onSelect(result.path); onOpenChange(false);
  }, [state.worktreeResult, request, onSelect, onOpenChange]);
  useEffect(() => {
    if (!pending) return;
    // A disconnected client has no durable job receipt. Never resend automatically.
    const timer = setTimeout(() => { setRequest(null); setError("No creation/selection receipt. Refresh discovery and inspect the checkout before retrying; it may already exist."); }, 75_000);
    if (!state.connected) { setRequest(null); setError("Connection lost. Refresh discovery after reconnecting before retrying; the operation may have changed the checkout."); }
    return () => clearTimeout(timer);
  }, [pending, state.connected]);
  const submit = () => {
    if (pending || !state.connected || !branch.trim() || discovery?.status !== "ready") return;
    const requestId = crypto.randomUUID(); setRequest(requestId); setError(null);
    send({ _tag: "create_worktree", requestId, project, branch: branch.trim(), hooks });
  };
  return <PopoverContent align="start" aria-label="Worktrees" className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] space-y-2 overflow-y-auto p-2">
      <div className="flex items-center gap-1">
        <Select value={project} onValueChange={setProject} disabled={pending}>
          <SelectTrigger aria-label="Worktree project" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>{state.projects.map(p => <SelectItem key={p.path} value={p.path}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="ghost" size="icon" aria-label="Refresh worktrees" title="Refresh worktrees" disabled={pending || !state.connected || refreshing} onClick={() => { setRefreshing(true); send({ _tag: "projects" }); }}><RefreshCwIcon className={refreshing ? "animate-spin" : ""} /></Button>
      </div>
      {!state.connected && <p className="text-sm text-ink-3">Disconnected — showing last observation.</p>}
      {discovery?.status === "error" && <div role="alert" className="whitespace-pre-wrap break-words text-sm text-err">{discovery.detail}</div>}
      {discovery?.status === "non-git" && <p className="text-sm text-ink-2">Non-Git directory. Chat is available; worktree creation is not.</p>}
      {discovery?.status === "ready" && <>
        <ul aria-label="Discovered worktrees">
          {discovery.worktrees.map(w => <li key={w.path}>
            <Button variant="ghost" aria-pressed={w.path === currentCwd} className="w-full justify-start font-normal" disabled={pending || !state.connected || refreshing || w.prunable !== undefined} onClick={() => {
              const requestId = crypto.randomUUID(); setRequest(requestId); setError(null);
              send({ _tag: "add_worktree", requestId, project, path: w.path });
            }}>
              <CheckIcon className={w.path === currentCwd ? "shrink-0" : "shrink-0 opacity-0"} />
              <span className="truncate">{w.branch ?? w.path.split("/").filter(Boolean).at(-1) ?? "Detached HEAD"}</span>
            </Button>
          </li>)}
        </ul>
        <form className="space-y-2 border-t border-line pt-2" onSubmit={e => { e.preventDefault(); submit(); }}>
          <div className="flex items-center gap-1">
            <Input id="wt-branch" aria-label="New branch" value={branch} disabled={pending} onChange={e => setBranch(e.target.value)} placeholder="New branch" autoComplete="off" />
            <Button type="submit" size="icon" variant="ghost" aria-label={pending ? "Waiting for Worktrunk" : "Create worktree"} title="Create worktree" disabled={!branch.trim() || pending || !state.connected || refreshing}>{pending ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}</Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={hooks} disabled={pending} onChange={e => setHooks(e.target.checked)} /> Run approved Worktrunk hooks</label>
          {hooks && <p className="text-xs text-ink-3">Unapproved project hooks block creation. Review and approve them in a terminal first. Background hooks may outlive creation.</p>}
        </form>
      </>}
      {error && <div ref={errorRef} role="alert" className="text-sm text-err">
        <p>Worktree operation not confirmed. Refresh discovery before retrying.</p>
        <p className="mt-1">For unapproved hooks, review and approve them in a terminal, or leave hooks off.</p>
        <details className="mt-2"><summary className="cursor-pointer">Error details</summary><p className="whitespace-pre-wrap break-words">{error}</p></details>
      </div>}
    </PopoverContent>;
}
