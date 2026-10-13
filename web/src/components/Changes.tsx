import {
  CHANGES_INITIAL_PATCH_BYTES,
  type ChangeFile,
  type Workspace,
  type WorkspaceChanges,
} from "@shared/wire";
import { cn } from "cn";
import {
  FileDiffIcon,
  FileMinusIcon,
  FilePlusIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { DisclosureChevron } from "@/components/Disclosure";
import { IconButton } from "@/components/IconButton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/PianoSheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { workspaceChangedFile, workspaceChanges } from "@/lib/api";
import {
  askText,
  changedFile,
  changesSheet,
  checkWorkspaceResponse,
  type Disclosure,
  FILE_PATCH_LIMIT,
  fileMessage,
  initialDisclosure,
  isLarge,
  type LoadedFile,
  refreshKey,
  type SheetBody,
  toggleEvery,
  toggleFile,
} from "@/lib/changesView";
import { type DiffFile, lineCount } from "@/lib/diff";
import { abbrevHome } from "@/lib/format";
import { useObservation } from "@/lib/useObservation";
import type { SessionView } from "@/store";

/** Live on open, focus and edits (a quiet 600 ms after the checkout may have moved); a response for another workspace never shows. */
function useWorkspaceChanges(
  workspace: Workspace | undefined,
  active: boolean,
  refreshKey: string,
) {
  const key = active && workspace ? JSON.stringify([workspace.id, workspace.path]) : null;
  const { value, failure, loading, refresh } = useObservation<WorkspaceChanges>(
    key,
    async (signal) =>
      checkWorkspaceResponse(workspace!, await workspaceChanges(workspace!.id, { signal })),
    { focus: true, trigger: refreshKey, debounce: 600 },
  );
  return {
    observation: value ?? null,
    error: failure,
    busy: loading,
    refresh: () => void refresh(),
  };
}

export function ChangesSheet({
  open,
  onOpenChange,
  workspace,
  session,
  onAsk,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace | undefined;
  session: SessionView | null;
  /** Receives review text for the composer draft; the caller decides how to close and confirm. */
  onAsk: (text: string) => void;
}) {
  const { observation, error, busy, refresh } = useWorkspaceChanges(
    workspace,
    open,
    refreshKey(session),
  );
  const [disclosure, setDisclosure] = useState<Disclosure>(initialDisclosure);
  const sheet = changesSheet({ observation, error, busy, disclosure });
  const { changes, body } = sheet;
  const ask = (loaded: LoadedFile) => onAsk(askText(loaded));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:w-[min(56rem,92vw)] sm:max-w-none"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b border-line pr-12">
          <SheetTitle>Changes</SheetTitle>
          <SheetDescription className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span>Working tree against HEAD</span>
            <span aria-hidden>·</span>
            {sheet.branch && <BranchLabel branch={sheet.branch} />}
            {sheet.branch && <span aria-hidden>·</span>}
            <span role="status" className="truncate">
              {sheet.status}
            </span>
            {sheet.refreshing && <Spinner className="size-3" />}
          </SheetDescription>
          <div className="-ml-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={!workspace}
              onClick={refresh}
              aria-label="Refresh changes"
            >
              <RefreshCwIcon className={cn(busy && "animate-spin")} /> Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={body.kind !== "files"}
              onClick={() => setDisclosure(toggleEvery(disclosure, sheet))}
            >
              {sheet.everyCollapsed ? "Expand all" : "Collapse all"}
            </Button>
          </div>
          {sheet.staleNote && (
            <p role="status" title={sheet.staleNote.detail} className="text-xs text-ink-2">
              {sheet.staleNote.text}
            </p>
          )}
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-4">
            <SheetBodyView
              body={body}
              onOpenChange={(path, next) => setDisclosure((d) => toggleFile(d, path, next))}
              onAsk={ask}
            />
          </div>
        </ScrollArea>
        {changes && (
          <SheetFooter className="mt-0 border-t border-line py-3">
            <Collapsible className="text-xs text-ink-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 h-7 text-xs">
                  Changes details
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="disclosure-content">
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all font-mono">
                  <dt>Checkout</dt>
                  <dd>{abbrevHome(changes.workspace.path)}</dd>
                  <dt>HEAD</dt>
                  <dd>{changes.result.head ?? "No commits yet"}</dd>
                  <dt>Observed</dt>
                  <dd>{new Date(changes.observedAt).toLocaleString()}</dd>
                </dl>
                <p className="mt-2 font-sans">
                  Live Git reads, not an immutable review or verification evidence. Expanding
                  unloaded files reads them afresh; files may change between reads. Refresh reloads
                  all patches. Ignored files are excluded. Renames appear as deletion and addition.
                </p>
                <p className="mt-2 font-sans">
                  Initial patch: {CHANGES_INITIAL_PATCH_BYTES.toLocaleString("en-US")} bytes.
                  Per-file patch: {FILE_PATCH_LIMIT}.{" "}
                  {changes.result.truncated ? "Expand unloaded files to read their patches." : ""}
                </p>
              </CollapsibleContent>
            </Collapsible>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBodyView({
  body,
  onOpenChange,
  onAsk,
}: {
  body: SheetBody;
  onOpenChange: (path: string, open: boolean) => void;
  onAsk: (loaded: LoadedFile) => void;
}) {
  switch (body.kind) {
    case "idle":
      return null;
    case "reading":
      return (
        <div className="flex items-center gap-2 py-10 text-sm text-ink-2" role="status">
          <Spinner className="size-4" /> Reading changes…
        </div>
      );
    case "failed":
      return (
        <Alert variant="destructive">
          <AlertTitle>Changes unavailable</AlertTitle>
          <AlertDescription>{body.detail}</AlertDescription>
        </Alert>
      );
    case "empty":
      return (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileDiffIcon />
            </EmptyMedia>
            <EmptyTitle>No changes</EmptyTitle>
            <EmptyDescription>
              The working tree matches HEAD. Untracked files would appear here too.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    case "files":
      return (
        <ItemGroup className="gap-2" aria-label="Changed files">
          {body.files.map(({ metadata, initial, open }) => (
            <LiveFile
              key={`${body.changes.workspace.id}:${body.changes.observedAt}:${metadata.path}`}
              metadata={metadata}
              initial={initial}
              workspace={body.changes.workspace}
              observedAt={body.changes.observedAt}
              open={open}
              onOpenChange={(next) => onOpenChange(metadata.path, next)}
              onAsk={onAsk}
            />
          ))}
        </ItemGroup>
      );
  }
}

function LiveFile({
  metadata,
  initial,
  workspace,
  observedAt,
  open,
  onOpenChange,
  onAsk,
}: {
  metadata: ChangeFile;
  initial?: DiffFile;
  workspace: Workspace;
  observedAt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAsk: (loaded: LoadedFile) => void;
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
    async (signal) =>
      changedFile(
        workspace,
        await workspaceChangedFile(workspace.id, metadata.path, { signal }),
        metadata.path,
      ),
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
      onAsk={loaded && open ? () => onAsk(loaded) : undefined}
      message={fileMessage({ error, busy, loaded })}
      retry={error ? () => void fetched.refresh() : undefined}
    />
  );
}

function FileSection({
  file,
  open,
  onOpenChange,
  onAsk,
  message,
  retry,
}: {
  file: DiffFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAsk?: () => void;
  message?: string;
  retry?: () => void;
}) {
  const Icon =
    file.status === "added"
      ? FilePlusIcon
      : file.status === "deleted"
        ? FileMinusIcon
        : FileDiffIcon;
  const large = isLarge(file);
  const description = [
    file.status === "added" ? "New file" : file.status === "deleted" ? "Deleted" : undefined,
    file.binary ? "Binary; contents not shown" : undefined,
    ...file.notes,
    large && !open ? `Large change (${lineCount(file)} lines); expand to read it` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-lg border border-line"
      data-path={file.path}
    >
      {/* Sticky within the sheet's scroll area so the file name stays in view while its hunks scroll. */}
      <Item size="sm" className="sticky top-0 z-10 gap-1 rounded-lg bg-background py-1.5 pl-1 pr-1">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-w-0 flex-1 justify-start gap-2 whitespace-normal px-2 py-1.5 text-left font-normal"
            aria-label={`${file.path}${file.binary ? "" : `, ${file.additions} added, ${file.deletions} removed`}: ${open ? "collapse" : "expand"}`}
          >
            <DisclosureChevron open={open} />
            <Icon className="size-3.5 shrink-0 text-ink-2" aria-hidden />
            <ItemContent className="min-w-0 gap-0">
              <ItemTitle className="min-w-0 break-all font-mono text-xs">{file.path}</ItemTitle>
              {description && <ItemDescription className="text-xs">{description}</ItemDescription>}
            </ItemContent>
            {!file.binary && (
              <span className="ml-auto shrink-0 font-mono text-xs tabular-nums">
                <span className="text-ok">+{file.additions}</span>{" "}
                <span className="text-err">−{file.deletions}</span>
              </span>
            )}
          </Button>
        </CollapsibleTrigger>
        <ItemActions>
          <IconButton
            label={`Ask about ${file.path}`}
            tooltip="Ask about this file"
            disabled={!onAsk}
            onClick={onAsk}
          >
            <MessageSquarePlusIcon />
          </IconButton>
        </ItemActions>
      </Item>
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
    </Collapsible>
  );
}

/** Hand-written: no shadcn component renders a unified diff. Numbers, marks and tints follow the transcript's tokens. */
function Hunks({ file }: { file: DiffFile }) {
  return (
    <div className="overflow-x-auto border-t border-line">
      <table
        className="w-full border-collapse font-mono text-xs leading-5"
        aria-label={`Diff of ${file.path}`}
      >
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
  return (
    <>
      <tr className="bg-fill text-ink-3">
        <td colSpan={3} className="select-none px-3 py-0.5 whitespace-pre">
          {hunk.header}
        </td>
      </tr>
      {hunk.lines.map((line, i) => (
        <tr
          // biome-ignore lint/suspicious/noArrayIndexKey: a hunk's lines are positional and never reorder.
          key={i}
          className={cn(
            line.kind === "add" && "bg-ok/10",
            line.kind === "del" && "bg-err/10",
            line.kind === "meta" && "text-ink-3",
          )}
        >
          <td className="w-10 select-none pl-3 pr-1 text-right text-ink-3 tabular-nums">
            {line.old ?? ""}
          </td>
          <td className="w-10 select-none pr-2 text-right text-ink-3 tabular-nums">
            {line.new ?? ""}
          </td>
          <td className="whitespace-pre pr-3">
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
            {line.text}
          </td>
        </tr>
      ))}
    </>
  );
}
