import { CHANGES_FILE_PATCH_BYTES, CHANGES_INITIAL_PATCH_BYTES, type ChangeFile, type Workspace, WorkspaceChanges } from "@shared/wire";
import { cn } from "cn";
import { Schema } from "effect";
import { FileDiffIcon, FileMinusIcon, FilePlusIcon, MessageSquarePlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { DisclosureChevron } from "@/components/Disclosure";
import { IconButton } from "@/components/IconButton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { type DiffFile, parseUnifiedDiff } from "@/lib/diff";
import { abbrevHome } from "@/lib/format";
import type { SessionView } from "@/store";

/** Tools whose completion can change the checkout; a finished turn is also a refresh point. */
const EDITING_TOOLS = new Set(["edit", "write", "bash"]);
const LARGE_FILE_LINES = 800;
const FILE_PATCH_LIMIT = `${CHANGES_FILE_PATCH_BYTES / (1024 * 1024)} MiB`;

/** Refresh live observations on open, focus and edits; superseded requests cannot publish. */
function useWorkspaceChanges(workspace: Workspace | undefined, active: boolean, mutationKey: string) {
  const [observation, setObservation] = useState<WorkspaceChanges | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const workspaceId = workspace?.id, workspacePath = workspace?.path;
  const refresh = useCallback(() => {
    if (!workspaceId || !workspacePath) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const mine = ++sequence.current;
    setBusy(true); setError(undefined);
    (async () => {
      const response = await fetch(`/api/workspace/changes?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", signal: request.signal });
      if (!response.ok) throw new Error(`Changes request failed (${response.status}). Refresh folders or inspect the server.`);
      const value = Schema.decodeUnknownSync(WorkspaceChanges)(await response.json());
      if (value.workspace.id !== workspaceId || value.workspace.path !== workspacePath) throw new Error("Changes returned a different workspace. Refresh before inspecting changes.");
      if (value.result.status === "error") throw new Error(value.result.detail);
      if (mine === sequence.current) setObservation(value);
    })().catch(e => { if (mine === sequence.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => {
        if (mine === sequence.current) setBusy(false);
      });
  }, [workspaceId, workspacePath]);
  // A new workspace starts from nothing; an older response for it is ignored.
  useEffect(() => {
    setObservation(null); setError(undefined); setBusy(false);
    if (active) refresh();
    return () => { sequence.current++; controller.current?.abort(); };
  }, [active, refresh]);
  useEffect(() => {
    if (!active) return;
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active, refresh]);
  const seenKey = useRef(mutationKey);
  useEffect(() => {
    if (!active || seenKey.current === mutationKey) { seenKey.current = mutationKey; return; }
    seenKey.current = mutationKey;
    const timer = setTimeout(refresh, 600);
    return () => clearTimeout(timer);
  }, [active, mutationKey, refresh]);
  return { observation, error, busy, refresh };
}

/** The latest checkout-changing tool result plus the streaming flag: when either moves, the checkout may have. */
function mutationKey(session: SessionView | null): string {
  if (!session) return "";
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role === "tool_result" && m.toolName && EDITING_TOOLS.has(m.toolName)) return `${m.id}|${session.state.isStreaming ? 1 : 0}`;
  }
  return `none|${session.state.isStreaming ? 1 : 0}`;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ChangesSheet({ open, onOpenChange, workspace, session, onAsk }: {
  open: boolean; onOpenChange: (open: boolean) => void; workspace: Workspace | undefined; session: SessionView | null;
  /** Receives review text for the composer draft; the caller decides how to close and confirm. */
  onAsk: (text: string) => void;
}) {
  const key = mutationKey(session);
  const { observation, error, busy, refresh } = useWorkspaceChanges(workspace, open, key);
  const result = observation?.workspace.id === workspace?.id ? observation?.result : undefined;
  const ready = result?.status === "ready" ? result : undefined;
  const files = ready?.files ?? [];
  const initial = useMemo(() => {
    const parsed = ready ? parseUnifiedDiff(ready.diff) : [];
    if (ready?.truncated) parsed.pop(); // The last file may have an incomplete hunk.
    return new Map(parsed.map(file => [file.path, file]));
  }, [ready]);
  const additions = files.reduce((n, f) => n + f.additions, 0), deletions = files.reduce((n, f) => n + f.deletions, 0);
  // Collapsed paths persist across refreshes so a reader keeps their place; large files start folded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expandedLarge, setExpandedLarge] = useState<Set<string>>(() => new Set());
  const isOpen = (f: ChangeFile) => !collapsed.has(f.path) && ((initial.has(f.path) && lineCount(initial.get(f.path)!) <= LARGE_FILE_LINES) || expandedLarge.has(f.path));
  const allCollapsed = files.length > 0 && files.every(f => !isOpen(f));
  const toggleAll = () => {
    if (allCollapsed) { setCollapsed(new Set()); setExpandedLarge(new Set(files.map(f => f.path))); }
    else setCollapsed(new Set(files.map(f => f.path)));
  };
  const ask = (file: DiffFile, observedAt: string, truncated: boolean) => {
    onAsk(`About \`${file.path}\` (live working-tree diff inspected at ${clock(observedAt)}; ${truncated ? "partial patch, not the complete file" : "not an immutable revision"}):\n\n\`\`\`diff\n${file.raw}\`\`\`\n`);
  };
  const summary = ready
    ? files.length === 0 ? "no changes" : `${files.length} ${files.length === 1 ? "file" : "files"} · +${additions} −${deletions}`
    : error || result ? "Changes unavailable" : "Loading…";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:w-[min(56rem,92vw)] sm:max-w-none" aria-describedby={undefined}>
        <SheetHeader className="border-b border-line pr-12">
          <SheetTitle>Changes</SheetTitle>
          <SheetDescription className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span>Working tree against HEAD</span>
            <span aria-hidden>·</span>
            {ready && <BranchLabel branch={ready.branch ?? "Detached HEAD"} />}
            {ready && <span aria-hidden>·</span>}
            <span role="status" className="truncate">{summary}</span>
            {busy && ready && <Spinner className="size-3" />}
          </SheetDescription>
          <div className="-ml-2 flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={!workspace} onClick={refresh} aria-label="Refresh changes"><RefreshCwIcon className={cn(busy && "animate-spin")} /> Refresh</Button>
            <Button variant="ghost" size="sm" disabled={files.length === 0} onClick={toggleAll}>{allCollapsed ? "Expand all" : "Collapse all"}</Button>
          </div>
          {error && ready && <p role="status" title={error} className="text-xs text-ink-2">Refresh failed. Showing previous changes.</p>}
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-4">
            {error && !ready && <Alert variant="destructive"><AlertTitle>Changes unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            {result?.status === "error" && <Alert variant="destructive"><AlertTitle>Changes unavailable</AlertTitle><AlertDescription>{result.detail}</AlertDescription></Alert>}
            {busy && !observation && !error && <div className="flex items-center gap-2 py-10 text-sm text-ink-2" role="status"><Spinner className="size-4" /> Reading changes…</div>}
            {ready && files.length === 0 && (
              <Empty className="py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><FileDiffIcon /></EmptyMedia>
                  <EmptyTitle>No changes</EmptyTitle>
                  <EmptyDescription>The working tree matches HEAD. Untracked files would appear here too.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {files.length > 0 && (
              <ItemGroup className="gap-2" aria-label="Changed files">
                {files.map(file => (
                  <LiveFile key={`${observation!.workspace.id}:${observation!.observedAt}:${file.path}`} metadata={file} initial={initial.get(file.path)} workspace={observation!.workspace} observedAt={observation!.observedAt} open={isOpen(file)}
                    onOpenChange={next => {
                      setCollapsed(prev => { const s = new Set(prev); if (next) s.delete(file.path); else s.add(file.path); return s; });
                      if (next) setExpandedLarge(prev => new Set(prev).add(file.path));
                    }}
                    onAsk={ask} />
                ))}
              </ItemGroup>
            )}
          </div>
        </ScrollArea>
        {ready && (
          <SheetFooter className="mt-0 border-t border-line py-3">
            <Collapsible className="text-xs text-ink-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 h-7 text-xs">Changes details</Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="disclosure-content">
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all font-mono">
                  <dt>Checkout</dt><dd>{abbrevHome(observation!.workspace.path)}</dd>
                  <dt>HEAD</dt><dd>{ready.head ?? "No commits yet"}</dd>
                  <dt>Observed</dt><dd>{new Date(observation!.observedAt).toLocaleString()}</dd>
                </dl>
                <p className="mt-2 font-sans">Live Git reads, not an immutable review or verification evidence. Expanding unloaded files reads them afresh; files may change between reads. Refresh reloads all patches. Ignored files are excluded. Renames appear as deletion and addition.</p>
                <p className="mt-2 font-sans">Initial patch: {CHANGES_INITIAL_PATCH_BYTES.toLocaleString("en-US")} bytes. Per-file patch: {FILE_PATCH_LIMIT}. {ready.truncated ? "Expand unloaded files to read their patches." : ""}</p>
              </CollapsibleContent>
            </Collapsible>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

const lineCount = (file: DiffFile) => file.hunks.reduce((n, h) => n + h.lines.length, 0);

function LiveFile({ metadata, initial, workspace, observedAt, open, onOpenChange, onAsk }: {
  metadata: ChangeFile; initial?: DiffFile; workspace: Workspace; observedAt: string; open: boolean;
  onOpenChange: (open: boolean) => void; onAsk: (file: DiffFile, observedAt: string, truncated: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(initial ? { file: { ...initial, ...metadata }, observedAt, truncated: false } : undefined);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || loaded) return;
    const controller = new AbortController();
    setBusy(true); setError(undefined);
    (async () => {
      const response = await fetch(`/api/workspace/changes/file?workspaceId=${encodeURIComponent(workspace.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: metadata.path }), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`File request failed (${response.status}).`);
      const value = Schema.decodeUnknownSync(WorkspaceChanges)(await response.json());
      if (value.workspace.id !== workspace.id || value.workspace.path !== workspace.path) throw new Error("File response belongs to another workspace.");
      if (value.result.status === "error") throw new Error(value.result.detail);
      const file = parseUnifiedDiff(value.result.diff).find(f => f.path === metadata.path);
      const stats = value.result.files.find(f => f.path === metadata.path);
      if (!stats) throw new Error("File metadata is unavailable. Refresh changes.");
      if (!file) throw new Error(value.result.truncated ? `Patch is too large to display a complete line (${FILE_PATCH_LIMIT} limit).` : "File changed or no longer has a diff. Refresh changes.");
      if (!controller.signal.aborted) setLoaded({ file: { ...file, ...stats }, observedAt: value.observedAt, truncated: value.result.truncated });
    })().catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, loaded, workspace.id, workspace.path, metadata.path, attempt]);
  const file: DiffFile = loaded?.file ?? { ...metadata, status: "modified", notes: [], hunks: [], raw: "" };
  return <FileSection file={file} open={open} onOpenChange={onOpenChange}
    onAsk={loaded && open ? () => onAsk(loaded.file, loaded.observedAt, loaded.truncated) : undefined}
    message={error ?? (busy && !loaded ? "Loading fresh patch…" : !loaded ? "Expand to load patch" : loaded.truncated ? `Partial patch: exceeds the ${FILE_PATCH_LIMIT} per-file limit. Inspect the remainder locally.` : undefined)}
    retry={error ? () => setAttempt(n => n + 1) : undefined} />;
}

function FileSection({ file, open, onOpenChange, onAsk, message, retry }: { file: DiffFile; open: boolean; onOpenChange: (open: boolean) => void; onAsk?: () => void; message?: string; retry?: () => void }) {
  const Icon = file.status === "added" ? FilePlusIcon : file.status === "deleted" ? FileMinusIcon : FileDiffIcon;
  const large = lineCount(file) > LARGE_FILE_LINES;
  const description = [
    file.status === "added" ? "New file" : file.status === "deleted" ? "Deleted" : undefined,
    file.binary ? "Binary; contents not shown" : undefined,
    ...file.notes,
    large && !open ? `Large change (${lineCount(file)} lines); expand to read it` : undefined,
  ].filter(Boolean).join(" · ");
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg border border-line" data-path={file.path}>
      {/* Sticky within the sheet's scroll area so the file name stays in view while its hunks scroll. */}
      <Item size="sm" className="sticky top-0 z-10 gap-1 rounded-lg bg-background py-1.5 pl-1 pr-1">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto min-w-0 flex-1 justify-start gap-2 whitespace-normal px-2 py-1.5 text-left font-normal" aria-label={`${file.path}${file.binary ? "" : `, ${file.additions} added, ${file.deletions} removed`}: ${open ? "collapse" : "expand"}`}>
            <DisclosureChevron open={open} />
            <Icon className="size-3.5 shrink-0 text-ink-2" aria-hidden />
            <ItemContent className="min-w-0 gap-0">
              <ItemTitle className="min-w-0 break-all font-mono text-xs">{file.path}</ItemTitle>
              {description && <ItemDescription className="text-xs">{description}</ItemDescription>}
            </ItemContent>
            {!file.binary && (
              <span className="ml-auto shrink-0 font-mono text-xs tabular-nums">
                <span className="text-ok">+{file.additions}</span> <span className="text-err">−{file.deletions}</span>
              </span>
            )}
          </Button>
        </CollapsibleTrigger>
        <ItemActions>
          <IconButton label={`Ask about ${file.path}`} tooltip="Ask about this file" disabled={!onAsk} onClick={onAsk}><MessageSquarePlusIcon /></IconButton>
        </ItemActions>
      </Item>
      <CollapsibleContent className="disclosure-content">
        {message && <p role="status" className="px-3 py-2 text-xs text-ink-2">{message} {retry && <Button variant="ghost" size="sm" onClick={retry}>Retry</Button>}</p>}
        {file.binary || file.hunks.length === 0
          ? !message && <p className="border-t border-line px-3 py-2 text-xs text-ink-3">{file.binary ? "Binary file." : "No text changes."}</p>
          : <Hunks file={file} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Hand-written: no shadcn component renders a unified diff. Numbers, marks and tints follow the transcript's tokens. */
function Hunks({ file }: { file: DiffFile }) {
  return (
    <div className="overflow-x-auto border-t border-line">
      <table className="w-full border-collapse font-mono text-xs leading-5" aria-label={`Diff of ${file.path}`}>
        <tbody>
          {file.hunks.map((hunk, h) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a diff's hunks are positional and never reorder.
            <HunkRows key={h} hunk={hunk} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HunkRows({ hunk }: { hunk: DiffFile["hunks"][number] }) {
  return <>
    <tr className="bg-fill text-ink-3">
      <td colSpan={3} className="select-none px-3 py-0.5 whitespace-pre">{hunk.header}</td>
    </tr>
    {hunk.lines.map((line, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: a hunk's lines are positional and never reorder.
      <tr key={i} className={cn(line.kind === "add" && "bg-ok/10", line.kind === "del" && "bg-err/10", line.kind === "meta" && "text-ink-3")}>
        <td className="w-10 select-none pl-3 pr-1 text-right text-ink-3 tabular-nums">{line.old ?? ""}</td>
        <td className="w-10 select-none pr-2 text-right text-ink-3 tabular-nums">{line.new ?? ""}</td>
        <td className="whitespace-pre pr-3">
          <span className={cn("inline-block w-4 select-none", line.kind === "add" ? "text-ok" : line.kind === "del" ? "text-err" : "text-ink-3")}>
            {line.kind === "add" ? "+" : line.kind === "del" ? "−" : line.kind === "meta" ? "\\" : " "}
          </span>
          {line.text}
        </td>
      </tr>
    ))}
  </>;
}
