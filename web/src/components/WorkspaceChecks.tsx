import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ListChecksIcon } from "lucide-react";
import { Schema } from "effect";
import { WorkspaceChecksView, type CheckEvidence, type Workspace } from "@shared/wire";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function WorkspaceChecks({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" onClick={() => setOpen(true)}><ListChecksIcon className="size-4" /> Checks</Button>
    <WorkspaceChecksDialog workspace={workspace} open={open} onOpenChange={setOpen} /></>;
}
export function WorkspaceChecksDialog({ workspace, open, onOpenChange, onCloseAutoFocus }: {
  workspace: Workspace; open: boolean; onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader><DialogTitle>Workspace checks</DialogTitle><DialogDescription className="break-all font-mono">{workspace.path}</DialogDescription></DialogHeader>
      {open && <Checks key={workspace.id} workspace={workspace} />}
    </DialogContent>
  </Dialog>;
}
function Checks({ workspace }: { workspace: Workspace }) {
  const [view, setView] = useState<WorkspaceChecksView>();
  const [error, setError] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch(`/api/workspace/checks?workspaceId=${encodeURIComponent(workspace.id)}`, { signal: abort.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Evidence request failed (${response.status})`);
        const value = Schema.decodeUnknownSync(WorkspaceChecksView)(body);
        if (value.workspace.id !== workspace.id || value.workspace.path !== workspace.path) throw new Error("Evidence returned a different workspace.");
        if (!abort.signal.aborted) { setView(value); setError(undefined); }
      } catch (e) { if (!abort.signal.aborted) setError(String(e)); }
      finally { if (!abort.signal.aborted) timer = setTimeout(read, 3000); }
    }
    void read();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [workspace.id, workspace.path, refresh]);
  async function act(action: "run" | "cancel", id?: string) {
    setPending(true); setRequestError(undefined);
    try {
      const response = await fetch(`/api/workspace/checks/${action}?workspaceId=${encodeURIComponent(workspace.id)}${id ? `&id=${encodeURIComponent(id)}` : ""}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Check request failed.");
    } catch (e) { if (mounted.current) setRequestError(`${String(e)} Inspect the retained history before trying again; requests are not replayed.`); }
    finally { if (mounted.current) { setPending(false); setRefresh(n => n + 1); } }
  }
  const active = view?.executions.find(e => e.execution.outcome === "running");
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span role="status" className="text-xs text-ink-2">{error ? "Evidence not refreshed" : view ? `Observed ${new Date(view.observedAt).toLocaleTimeString()}` : "Loading checks…"}</span>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setRefresh(n => n + 1)}>Refresh evidence</Button>
        {active ? <Button variant="outline" size="sm" disabled={pending} onClick={() => void act("cancel", active.execution.id)}>Cancel check</Button>
          : <Button size="sm" disabled={pending || !view?.definition || !!error} onClick={() => void act("run")}>{pending ? "Starting…" : "Run check"}</Button>}
      </div>
    </div>
    <div className="min-h-0 space-y-4 overflow-auto text-sm">
      {[error, requestError, view?.configurationError, view?.observationError].filter(Boolean).map((message, i) => <p key={i} role="alert" className="break-words text-err">{message}</p>)}
      {view?.definition && <section className="space-y-1">
        <h3 className="font-medium">{view.definition.name}</h3>
        <p>{view.definition.criterion.content}</p>
        <p className="text-xs text-ink-2">{view.definition.task.id} · {view.definition.criterion.id} · version {view.definition.criterion.version}</p>
        <details className="text-xs text-ink-2"><summary className="cursor-pointer">Configured requirement and check</summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded-md bg-fill p-3">{JSON.stringify(view.definition, null, 2)}</pre>
        </details>
      </section>}
      {view && !view.executions.length && <p className="text-ink-2">No check executions yet.</p>}
      {view?.executions.map(evidence => <Evidence key={evidence.execution.id} evidence={evidence} unavailable={!!error} />)}
    </div>
  </>;
}
function Evidence({ evidence, unavailable }: { evidence: CheckEvidence; unavailable: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { execution: run } = evidence;
  const validity = unavailable ? "unknown" : evidence.validity;
  const evaluation = unavailable ? "unknown" : evidence.evaluation;
  return <section className="space-y-2 rounded-md border border-line p-3" data-execution={run.id} data-outcome={run.outcome} data-validity={validity}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-medium">{run.definition.name} · {run.outcome === "pass" ? "Passed" : run.outcome === "fail" ? "Failed" : run.outcome[0].toUpperCase() + run.outcome.slice(1)}</h3>
      <span className="text-xs text-ink-2">{validity === "current" ? "Current at observation" : validity === "stale" ? "Stale" : "Validity unknown"}</span>
    </div>
    <p className="text-xs text-ink-2">{new Date(run.startedAt).toLocaleString()} · Revision <span className="font-mono" title={run.revision}>{run.revision.slice(0, 15)}</span></p>
    <p>{unavailable ? "Refresh evidence before relying on this result." : evidence.reason}</p>
    <p className="text-xs text-ink-2">Criterion {run.definition.criterion.id}: {evaluation === "satisfied" ? "satisfied by this check" : evaluation === "not-satisfied" ? "not satisfied" : "not established"}</p>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-xs">Output and execution details</summary>
      {expanded && <div className="mt-2 space-y-2 text-xs">
        <p>{run.detail}</p>
        <pre className="max-h-72 overflow-auto rounded-md bg-fill p-3" aria-label="Check output">{evidence.output ?? "Output is not available yet."}</pre>
        <details><summary className="cursor-pointer">Provenance</summary><pre className="overflow-auto whitespace-pre-wrap break-all p-2">{JSON.stringify(run, null, 2)}</pre></details>
      </div>}
    </details>
  </section>;
}
