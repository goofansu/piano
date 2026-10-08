import { type Workspace, WorkspaceCapture } from "@shared/wire";
import { cn } from "cn";
import { Schema } from "effect";
import { ChevronRightIcon, FileDiffIcon, FileMinusIcon, FilePlusIcon, GitBranchIcon, MessageSquarePlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type DiffFile, parseUnifiedDiff } from "@/lib/diff";
import { abbrevHome } from "@/lib/format";
import type { SessionView } from "@/store";

/** Tools whose completion can change the checkout; a finished turn is also a refresh point. */
const EDITING_TOOLS = new Set(["edit", "write", "bash"]);
const LARGE_FILE_LINES = 800;

/** Capture the workspace while the sheet is open: on open, on window focus and after edits.
 * Overlapping requests coalesce into one trailing capture; stale responses are dropped.
 */
function useWorkspaceCapture(workspace: Workspace | undefined, active: boolean, mutationKey: string) {
  const [capture, setCapture] = useState<WorkspaceCapture | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0), inflight = useRef(false), again = useRef(false);
  const workspaceId = workspace?.id, workspacePath = workspace?.path;
  const refresh = useCallback(() => {
    if (!workspaceId || !workspacePath) return;
    if (inflight.current) { again.current = true; return; }
    const mine = ++sequence.current;
    inflight.current = true; setBusy(true); setError(undefined);
    (async () => {
      const response = await fetch(`/api/workspace/capture?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST" });
      if (!response.ok) throw new Error(`Capture request failed (${response.status}). Refresh projects or inspect the server.`);
      const value = Schema.decodeUnknownSync(WorkspaceCapture)(await response.json());
      if (value.workspace.id !== workspaceId || value.workspace.path !== workspacePath) throw new Error("Capture returned a different workspace. Refresh before inspecting changes.");
      if (mine === sequence.current) setCapture(value);
    })().catch(e => { if (mine === sequence.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => {
        inflight.current = false;
        if (mine !== sequence.current) return;
        setBusy(false);
        if (again.current) { again.current = false; refresh(); }
      });
  }, [workspaceId, workspacePath]);
  // A new workspace starts from nothing; an older response for it is ignored.
  useEffect(() => { setCapture(null); setError(undefined); setBusy(false); sequence.current++; inflight.current = false; again.current = false; }, [workspaceId, workspacePath]);
  useEffect(() => { if (active) refresh(); }, [active, refresh]);
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
  return { capture, error, busy, refresh };
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
  const { capture, error, busy, refresh } = useWorkspaceCapture(workspace, open, key);
  const result = capture?.result;
  const captured = result?.status === "captured" ? result : undefined;
  const files = useMemo(() => captured ? parseUnifiedDiff(captured.diff) : [], [captured]);
  const additions = files.reduce((n, f) => n + f.additions, 0), deletions = files.reduce((n, f) => n + f.deletions, 0);
  // Collapsed paths persist across refreshes so a reader keeps their place; large files start folded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expandedLarge, setExpandedLarge] = useState<Set<string>>(() => new Set());
  const isOpen = (f: DiffFile) => !collapsed.has(f.path) && (lineCount(f) <= LARGE_FILE_LINES || expandedLarge.has(f.path));
  const allCollapsed = files.length > 0 && files.every(f => !isOpen(f));
  const toggleAll = () => {
    if (allCollapsed) { setCollapsed(new Set()); setExpandedLarge(new Set(files.map(f => f.path))); }
    else setCollapsed(new Set(files.map(f => f.path)));
  };
  const ask = (file: DiffFile) => {
    if (!captured || !capture) return;
    onAsk(`About \`${file.path}\` (working tree against HEAD ${captured.manifest.baseHead.slice(0, 12)}, captured ${clock(capture.observedAt)}):\n\n\`\`\`diff\n${file.raw}\`\`\`\n`);
  };
  const summary = captured
    ? files.length === 0 ? "no changes" : `${files.length} ${files.length === 1 ? "file" : "files"} · +${additions} −${deletions}`
    : error || result ? "Capture unavailable" : "Capturing…";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:w-[min(56rem,92vw)] sm:max-w-none" aria-describedby={undefined}>
        <SheetHeader className="border-b border-line pr-12">
          <SheetTitle>Changes</SheetTitle>
          <SheetDescription className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span>Working tree against HEAD</span>
            <span aria-hidden>·</span>
            {captured && <span className="inline-flex min-w-0 items-center gap-1"><GitBranchIcon className="size-3 shrink-0" aria-hidden /><span className="truncate">{captured.branch ?? "Detached HEAD"}</span></span>}
            {captured && <span aria-hidden>·</span>}
            <span role="status" className="truncate">{summary}</span>
            {busy && captured && <Spinner className="size-3" />}
          </SheetDescription>
          <div className="-ml-2 flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={!workspace} onClick={refresh} aria-label="Refresh changes"><RefreshCwIcon className={cn(busy && "animate-spin")} /> Refresh</Button>
            <Button variant="ghost" size="sm" disabled={files.length === 0} onClick={toggleAll}>{allCollapsed ? "Expand all" : "Collapse all"}</Button>
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-4">
            {error && <Alert variant="destructive"><AlertTitle>Capture unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            {!error && result && result.status !== "captured" && (
              <Alert variant="destructive">
                <AlertTitle>{result.status === "inconclusive" ? "Capture inconclusive" : result.status === "unsupported" ? "Capture unsupported" : "Capture failed"}</AlertTitle>
                <AlertDescription>{result.detail}</AlertDescription>
              </Alert>
            )}
            {(error || (result && result.status !== "captured")) && captured && <p className="text-sm text-warn">Showing the previous capture; it was not refreshed.</p>}
            {busy && !capture && !error && <div className="flex items-center gap-2 py-10 text-sm text-ink-2" role="status"><Spinner className="size-4" /> Capturing the working tree…</div>}
            {captured && files.length === 0 && (
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
                  <FileSection key={file.path} file={file} open={isOpen(file)}
                    onOpenChange={next => {
                      setCollapsed(prev => { const s = new Set(prev); if (next) s.delete(file.path); else s.add(file.path); return s; });
                      if (next && lineCount(file) > LARGE_FILE_LINES) setExpandedLarge(prev => new Set(prev).add(file.path));
                    }}
                    onAsk={() => ask(file)} />
                ))}
              </ItemGroup>
            )}
          </div>
        </ScrollArea>
        {captured && (
          <SheetFooter className="mt-0 border-t border-line py-3">
            <Collapsible className="text-xs text-ink-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 h-7 text-xs">Capture details</Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="disclosure-content">
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all font-mono">
                  <dt>Checkout</dt><dd>{abbrevHome(captured.physicalPath)}</dd>
                  <dt>HEAD</dt><dd>{captured.manifest.baseHead}</dd>
                  <dt>Revision</dt><dd>{captured.revision}</dd>
                  <dt>Captured</dt><dd>{new Date(capture!.observedAt).toLocaleString()}</dd>
                </dl>
                <ul className="mt-2 list-disc pl-4 font-sans">{captured.limitations.map(text => <li key={text}>{text}</li>)}</ul>
                <p className="mt-2 font-sans">A saved capture, not a live view or a passing check. Edits made after it appear on refresh.</p>
              </CollapsibleContent>
            </Collapsible>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

const lineCount = (file: DiffFile) => file.hunks.reduce((n, h) => n + h.lines.length, 0);

function FileSection({ file, open, onOpenChange, onAsk }: { file: DiffFile; open: boolean; onOpenChange: (open: boolean) => void; onAsk: () => void }) {
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
          <Button variant="ghost" size="sm" className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left font-normal" aria-label={`${file.path}${file.binary ? "" : `, ${file.additions} added, ${file.deletions} removed`}: ${open ? "collapse" : "expand"}`}>
            <ChevronRightIcon className={cn("size-3.5 shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-90")} aria-hidden />
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Ask about ${file.path}`} onClick={onAsk}><MessageSquarePlusIcon /></Button>
            </TooltipTrigger>
            <TooltipContent>Ask about this file</TooltipContent>
          </Tooltip>
        </ItemActions>
      </Item>
      <CollapsibleContent className="disclosure-content">
        {file.binary || file.hunks.length === 0
          ? <p className="border-t border-line px-3 py-2 text-xs text-ink-3">{file.binary ? "Binary file." : "No text changes."}</p>
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
