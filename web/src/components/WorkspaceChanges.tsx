import { useEffect, useRef, useState } from "react";
import { FileDiffIcon } from "lucide-react";
import { Schema } from "effect";
import { WorkspaceCapture, type Workspace } from "@shared/wire";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Each mounted inspector owns one workspace. Aborted/older responses cannot relabel
 * another workspace's diff. Captures are observations, never verification badges.
 */
export function WorkspaceChanges({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><FileDiffIcon className="size-4" /> Changes</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl">
        <DialogHeader><DialogTitle>Workspace changes</DialogTitle>
          <DialogDescription className="break-all font-mono">{workspace.path}</DialogDescription></DialogHeader>
        {open && <Capture key={workspace.id} workspace={workspace} />}
      </DialogContent>
    </Dialog>
  </>;
}
function Capture({ workspace }: { workspace: Workspace }) {
  const [capture, setCapture] = useState<WorkspaceCapture | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const abort = new AbortController(), mine = ++sequence.current;
    setBusy(true); setError(undefined);
    (async () => {
      const response = await fetch(`/api/workspace/capture?workspaceId=${encodeURIComponent(workspace.id)}`, { method: "POST", signal: abort.signal });
      if (!response.ok) throw new Error(`Capture request failed (${response.status}). Refresh projects or inspect the server.`);
      const value = Schema.decodeUnknownSync(WorkspaceCapture)(await response.json());
      if (value.workspace.id !== workspace.id || value.workspace.path !== workspace.path) throw new Error("Capture returned a different workspace. Refresh before inspecting changes.");
      if (mine === sequence.current) setCapture(value);
    })().catch(e => { if (!abort.signal.aborted && mine === sequence.current) setError(String(e)); })
      .finally(() => { if (!abort.signal.aborted && mine === sequence.current) setBusy(false); });
    return () => { abort.abort(); sequence.current++; };
  }, [workspace.id, workspace.path, refresh]);
  const result = capture?.result;
  return <>
    <div className="flex items-center justify-between gap-2 text-sm text-ink-2">
      <span role="status">{busy ? "Capturing…" : error ? "Capture unavailable" : result?.status === "captured" ? `Captured ${new Date(capture!.observedAt).toLocaleTimeString()}` : "Capture unavailable"}</span>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setRefresh(n => n + 1)}>Refresh changes</Button>
    </div>
    <div className="min-h-0 space-y-4 overflow-auto text-sm">
      {error && <p role="alert" className="text-err">{error}</p>}
      {!busy && result && result.status !== "captured" && <p role="alert" className="text-err">{result.status === "inconclusive" ? "Capture inconclusive" : result.status === "unsupported" ? "Capture unsupported" : "Capture failed"}: {result.detail}</p>}
      {result?.status === "captured" && <div className="space-y-4" aria-label="Captured changes">
        {(busy || error) && <p className="text-warn">Previous capture — not refreshed.</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-2">
          <span>{result.branch ?? "Detached HEAD"}</span>
          <span title={result.revision} data-revision={result.revision}>Revision {result.revision.slice(0, 15)}</span>
          <span title={result.manifest.baseHead}>HEAD {result.manifest.baseHead.slice(0, 12)}</span>
        </div>
        {!result.stagedDiff && !result.unstagedDiff && <p>No changes in capture scope.</p>}
        {result.stagedDiff && <section><h3 className="mb-2 font-medium">Staged</h3><pre className="overflow-x-auto rounded-md bg-fill p-3 text-xs" aria-label="Staged diff">{result.stagedDiff}</pre></section>}
        {result.unstagedDiff && <section><h3 className="mb-2 font-medium">Unstaged and untracked</h3><pre className="overflow-x-auto rounded-md bg-fill p-3 text-xs" aria-label="Unstaged diff">{result.unstagedDiff}</pre></section>}
        <details className="text-xs text-ink-2"><summary className="cursor-pointer">Capture details and scope</summary>
          <div className="mt-2 space-y-2 break-words">
            <p>Workspace: {workspace.id}</p><p>Checkout: {result.physicalPath}</p><p>Revision: {result.revision}</p>
            <p>{result.manifest.scope.included}</p><p>Excluded: {result.manifest.scope.excluded.join("; ")}</p>
            {result.limitations.map(text => <p key={text}>{text}</p>)}
            <p>This is a saved candidate, not a live view or a passing check. Refresh after edits. Displayed content is redacted; the private candidate retains original bytes.</p>
            <details><summary className="cursor-pointer">Version {result.manifest.version} manifest</summary><pre className="overflow-x-auto p-2">{JSON.stringify(result.manifest, null, 2)}</pre></details>
          </div>
        </details>
      </div>}
    </div>
  </>;
}
