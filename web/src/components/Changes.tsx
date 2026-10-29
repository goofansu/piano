import type { ChangeFile, ChangesScope, Comparison, Workspace } from "@shared/wire";
import { cn } from "cn";
import { FileDiffIcon, GitPullRequestIcon, MessageSquarePlusIcon } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChangesActions, ChangesScopeMenu, ChangesStaleNote } from "@/components/ChangesHeader";
import { DisclosureChevron } from "@/components/Disclosure";
import { FilePath } from "@/components/FilePath";
import { IconButton } from "@/components/IconButton";
import { type PullRequestControl, PullRequestRow } from "@/components/SessionPullRequest";
import { SurfaceFrame } from "@/components/SurfaceArea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { sessionChangedFile, sessionChanges, setSessionChangesScope } from "@/lib/api";
import {
  askText,
  changedFile,
  changesSheet,
  checkWorkspaceResponse,
  type Disclosure,
  fileMessage,
  initialDisclosure,
  isLarge,
  type LoadedFile,
  refreshKey,
  type SheetBody,
  type ShownChanges,
  toggleEvery,
  toggleFile,
} from "@/lib/changesView";
import { type DiffFile, type DiffLine, lineCount } from "@/lib/diff";
import { lineBlocks } from "@/lib/lineBlocks";
import { useChangesWrap } from "@/lib/useChangesWrap";
import { useObservation } from "@/lib/useObservation";
import type { SessionView } from "@/store";

/** One file's fresh patch under the comparison its list was read with. */
type ReadFile = (path: string, signal: AbortSignal) => Promise<LoadedFile>;

/**
 * The session's Changes, live while shown: on showing, focus and edits (a quiet 600 ms after the
 * checkout may have moved); a response for another workspace never shows. Reads use the
 * session's saved scope; choosing one saves it and the answer replaces the view.
 */
function useSessionChanges(
  workspace: Workspace | undefined,
  sessionId: string | null | undefined,
  active: boolean,
  refreshKey: string,
) {
  const key =
    workspace && sessionId ? JSON.stringify([workspace.id, workspace.path, sessionId]) : null;
  const { value, failure, loading, mutating, refresh, mutate } = useObservation<ShownChanges>(
    key,
    async (signal) =>
      checkWorkspaceResponse(
        workspace!,
        await sessionChanges(workspace!.id, sessionId!, undefined, { signal }),
      ),
    { enabled: active, focus: true, trigger: refreshKey, debounce: 600 },
  );
  const setScope = (scope: ChangesScope) =>
    mutate(async (signal) =>
      checkWorkspaceResponse(
        workspace!,
        await setSessionChangesScope(workspace!.id, sessionId!, scope, { signal }),
      ),
    ).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not save the comparison.");
    });
  const readFile =
    (comparison: Comparison): ReadFile =>
    async (path, signal) =>
      changedFile(
        workspace!,
        await sessionChangedFile(
          workspace!.id,
          sessionId!,
          { path, scope: comparison.scope },
          { signal },
        ),
        path,
        comparison,
      );
  return {
    observation: value ?? null,
    error: failure,
    busy: loading || mutating,
    refresh: () => void refresh(),
    setScope,
    readFile,
  };
}

export function ChangesPanel({
  workspace,
  unavailable,
  session,
  active,
  onAsk,
  pullRequest,
}: {
  workspace: Workspace | undefined;
  /** Why Changes cannot open; it then shows that alone and reads nothing until it can. */
  unavailable: string | undefined;
  session: SessionView | null;
  /** Shown on screen: Git is read only then, and a hidden panel keeps its last observation. */
  active: boolean;
  /** Receives review text for the composer draft; the caller decides how to confirm. Omitted
   * while the draft takes no additions, which hides Ask. */
  onAsk: ((text: string) => void) | undefined;
  /** The session's pull request: a toolbar action until linked, then a row below it. */
  pullRequest: PullRequestControl;
}) {
  const { observation, error, busy, refresh, setScope, readFile } = useSessionChanges(
    unavailable ? undefined : workspace,
    session?.sessionId,
    active && !unavailable,
    // Linking or changing the pull request can change the target and whether it is this branch's.
    `${refreshKey(session)}|${pullRequest.changesTrigger}`,
  );
  const [disclosure, setDisclosure] = useState<Disclosure>(initialDisclosure);
  const sheet = changesSheet({ observation, error, busy, disclosure });
  const { body } = sheet;
  const ask = onAsk && ((loaded: LoadedFile) => onAsk(askText(loaded)));

  return (
    <SurfaceFrame
      tab="changes"
      status={
        !unavailable &&
        sheet.scope && <ChangesScopeMenu scope={sheet.scope} disabled={busy} onScope={setScope} />
      }
      actions={
        <>
          {!unavailable && !pullRequest.linked && (
            <IconButton
              data-pull-request-trigger
              size="header"
              label="Pull request"
              disabled={!pullRequest.addressable || pullRequest.busy}
              onClick={pullRequest.open}
            >
              <GitPullRequestIcon />
            </IconButton>
          )}
          <ChangesActions
            sheet={sheet}
            canRefresh={!!workspace && !unavailable}
            refresh={refresh}
            toggleEvery={() => setDisclosure(toggleEvery(disclosure, sheet))}
          />
        </>
      }
      below={
        <>
          {!unavailable && (
            <PullRequestRow
              pr={pullRequest}
              fromBranch={sheet.pullRequestFromBranch}
              local={sheet.local}
            />
          )}
          <ChangesStaleNote sheet={sheet} />
        </>
      }
    >
      <div className="flex min-h-full flex-col">
        <SheetBodyView
          body={unavailable ? { kind: "unavailable", reason: unavailable } : body}
          readFile={readFile}
          onOpenChange={(path, next) => setDisclosure((d) => toggleFile(d, path, next))}
          onAsk={ask}
        />
      </div>
    </SurfaceFrame>
  );
}

function SheetBodyView({
  body,
  readFile,
  onOpenChange,
  onAsk,
}: {
  body: SheetBody | { kind: "unavailable"; reason: string };
  readFile: (comparison: Comparison) => ReadFile;
  onOpenChange: (path: string, open: boolean) => void;
  onAsk: ((loaded: LoadedFile) => void) | undefined;
}) {
  switch (body.kind) {
    case "idle":
      return null;
    case "reading":
      return (
        <div className="flex items-center gap-2 px-4 py-10 text-sm text-ink-2" role="status">
          <Spinner className="size-4" /> Reading changes…
        </div>
      );
    case "failed":
      return (
        <Alert variant="destructive" className="m-4 w-auto">
          <AlertTitle>{body.title ?? "Changes unavailable"}</AlertTitle>
          <AlertDescription>{body.detail}</AlertDescription>
        </Alert>
      );
    case "unavailable":
      return (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileDiffIcon />
            </EmptyMedia>
            <EmptyTitle>{body.reason}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      );
    case "empty":
      return (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileDiffIcon />
            </EmptyMedia>
            <EmptyTitle>No changes</EmptyTitle>
          </EmptyHeader>
        </Empty>
      );
    case "files":
      return (
        <ul aria-label="Changed files">
          {body.files.map(({ metadata, initial, open }) => (
            <LiveFile
              key={`${body.changes.workspace.id}:${body.changes.observedAt}:${metadata.path}`}
              metadata={metadata}
              initial={initial}
              workspace={body.changes.workspace}
              observedAt={body.changes.observedAt}
              readFile={readFile(body.changes.result.comparison)}
              open={open}
              onOpenChange={(next) => onOpenChange(metadata.path, next)}
              onAsk={onAsk}
            />
          ))}
        </ul>
      );
  }
}

function LiveFile({
  metadata,
  initial,
  workspace,
  observedAt,
  readFile,
  open,
  onOpenChange,
  onAsk,
}: {
  metadata: ChangeFile;
  initial?: DiffFile;
  workspace: Workspace;
  observedAt: string;
  readFile: ReadFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAsk: ((loaded: LoadedFile) => void) | undefined;
}) {
  const seeded = useMemo<LoadedFile | undefined>(
    () =>
      initial ? { file: { ...initial, ...metadata }, observedAt, truncated: false } : undefined,
    [initial, metadata, observedAt],
  );
  // Read when first expanded; collapsing before it arrives abandons the read, and a loaded patch
  // stays (collapsed or not) until the parent observes the checkout again and remounts this file.
  const [kept, setKept] = useState(false);
  const fetched = useObservation(
    JSON.stringify([workspace.id, workspace.path, metadata.path]),
    (signal) => readFile(metadata.path, signal),
    { enabled: !seeded && (open || kept) },
  );
  useEffect(() => {
    if (fetched.value) setKept(true);
  }, [fetched.value]);
  const loaded = seeded ?? fetched.value;
  const error = fetched.failure,
    busy = fetched.loading;
  const file: DiffFile = loaded?.file ?? {
    ...metadata,
    status: "modified",
    notes: [],
    hunks: [],
    raw: "",
  };
  return (
    <FileSection
      file={file}
      open={open}
      onOpenChange={onOpenChange}
      canAsk={!!onAsk}
      onAsk={onAsk && loaded && open ? () => onAsk(loaded) : undefined}
      message={fileMessage({ error, busy, loaded })}
      retry={error ? () => void fetched.refresh() : undefined}
    />
  );
}

function FileSection({
  file,
  open,
  onOpenChange,
  canAsk,
  onAsk,
  message,
  retry,
}: {
  file: DiffFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ask shows at all; `onAsk` is set once the open file's patch can be quoted. */
  canAsk: boolean;
  onAsk?: () => void;
  message?: string;
  retry?: () => void;
}) {
  const large = isLarge(file);
  // A new or deleted file shows by its name's colour (and in its label); a binary file's kind sits
  // beside the size; notes that need a sentence go beneath.
  const status =
    file.status === "added" ? "new" : file.status === "deleted" ? "deleted" : undefined;
  const description = [
    ...file.notes,
    large && !open ? `Large change (${lineCount(file)} lines); expand to read it` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <li className="border-b border-line" data-path={file.path}>
        {/* Hand-written: no standard component fits a flat, hairline-divided diff row. Collapsible
         * supplies disclosure semantics only; this grid owns spacing, without Item/Button borders.
         * Sticky within the sheet so the file name stays in view while its hunks scroll. */}
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1 bg-conversation px-2 py-1">
          <CollapsibleTrigger
            // A 16px line with even padding is 36px (44px on touch).
            className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-2 py-2.5 text-left text-xs leading-4 outline-none select-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:py-3.5"
            aria-label={`${file.path}${status ? `, ${status}` : ""}${file.binary ? "" : `, ${file.additions} added, ${file.deletions} removed`}: ${open ? "collapse" : "expand"}`}
          >
            <span className="flex h-4 items-center">
              <DisclosureChevron open={open} />
            </span>
            <FilePath
              path={file.path}
              title={status ? `${file.path} (${status})` : file.path}
              filenameClassName={cn(
                status === "new" && "text-ok",
                status === "deleted" && "text-err line-through",
              )}
            />
            <span className="flex items-center gap-2">
              {file.binary && <span className="text-ink-3">Binary</span>}
              {!file.binary && (
                <span className="whitespace-nowrap font-mono tabular-nums">
                  <span className="text-ok">+{file.additions}</span>{" "}
                  <span className="text-err">−{file.deletions}</span>
                </span>
              )}
            </span>
          </CollapsibleTrigger>
          {canAsk && (
            // Centre Ask on the name line.
            <div className="flex h-9 items-center pointer-coarse:h-11">
              <IconButton
                size="list"
                label={`Ask about ${file.path}`}
                tooltip="Ask about this file"
                disabled={!onAsk}
                onClick={onAsk}
              >
                <MessageSquarePlusIcon />
              </IconButton>
            </div>
          )}
          {description && (
            <p className="col-span-full pr-2 pb-2.5 pl-8 text-xs leading-normal text-muted-foreground [overflow-wrap:anywhere]">
              {description}
            </p>
          )}
        </div>
        <CollapsibleContent className="disclosure-content">
          {message && (
            <p role="status" className="px-3 py-2 text-xs text-ink-2">
              {message}{" "}
              {retry && (
                <Button variant="ghost" size="sm" onClick={retry}>
                  Retry
                </Button>
              )}
            </p>
          )}
          {file.binary || file.hunks.length === 0 ? (
            !message && (
              <p className="border-t border-line px-3 py-2 text-xs text-ink-3">
                {file.binary ? "Binary file." : "No text changes."}
              </p>
            )
          ) : (
            <Hunks file={file} />
          )}
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

/** Hand-written: no shadcn component renders a unified diff. Numbers, marks and tints follow the transcript's tokens. */
function Hunks({ file }: { file: DiffFile }) {
  const [wrap] = useChangesWrap();
  // Fixed-layout wrapping must still leave room for large line numbers (not just two digits).
  const digits = useMemo(() => {
    let largest = 99;
    for (const hunk of file.hunks)
      for (const line of hunk.lines) largest = Math.max(largest, line.old ?? 0, line.new ?? 0);
    return String(largest).length;
  }, [file]);
  // Each block is its own table so the browser can skip blocks off screen (`lazy-lines`); the
  // shared column widths keep them aligned. Unwrapped, every block takes the widest one's width.
  const blocks = useMemo(
    () =>
      lineBlocks(
        file.hunks.flatMap((hunk): DiffRow[] => [
          { header: hunk.header },
          ...hunk.lines.map((line) => ({ line })),
        ]),
      ),
    [file],
  );
  return (
    <div className="overflow-x-auto border-t border-line">
      <section
        aria-label={`Diff of ${file.path}`}
        className={cn("font-mono text-xs leading-5", !wrap && "w-max min-w-full")}
      >
        {blocks.map((block) => (
          <div
            key={block.start}
            className="lazy-lines"
            style={{ "--lines": block.items.length } as CSSProperties}
          >
            <table className={cn("w-full border-collapse", wrap && "table-fixed")}>
              <colgroup>
                <col style={{ width: `calc(${digits}ch + 1rem)` }} />
                <col style={{ width: `calc(${digits}ch + 1rem)` }} />
                <col />
              </colgroup>
              <tbody>
                {block.items.map((row, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a diff's rows are positional and never reorder.
                  <DiffRowView key={i} row={row} wrap={wrap} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  );
}

type DiffRow = { header: string } | { line: DiffLine };

function DiffRowView({ row, wrap }: { row: DiffRow; wrap: boolean }) {
  if ("header" in row)
    return (
      <tr className="bg-fill text-ink-3">
        <td
          colSpan={3}
          className={cn(
            "select-none px-3 py-0.5",
            wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre",
          )}
        >
          {row.header}
        </td>
      </tr>
    );
  const { line } = row;
  return (
    <tr
      className={cn(
        line.kind === "add" && "bg-ok/10",
        line.kind === "del" && "bg-err/10",
        line.kind === "meta" && "text-ink-3",
      )}
    >
      <td className="select-none pl-2 pr-1 text-right align-top text-ink-3 tabular-nums">
        {line.old ?? ""}
      </td>
      <td className="select-none pr-2 text-right align-top text-ink-3 tabular-nums">
        {line.new ?? ""}
      </td>
      <td className="pr-3 align-top">
        <span className={cn(wrap ? "grid grid-cols-[1rem_minmax(0,1fr)]" : "whitespace-pre")}>
          <span
            className={cn(
              "inline-block w-4 select-none",
              line.kind === "add" ? "text-ok" : line.kind === "del" ? "text-err" : "text-ink-3",
            )}
          >
            {line.kind === "add"
              ? "+"
              : line.kind === "del"
                ? "−"
                : line.kind === "meta"
                  ? "\\"
                  : " "}
          </span>
          <span className={cn(wrap && "whitespace-pre-wrap [overflow-wrap:anywhere]")}>
            {line.text}
          </span>
        </span>
      </td>
    </tr>
  );
}
