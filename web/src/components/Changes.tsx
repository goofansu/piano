import type { ChangeFile, Workspace, WorkspaceChanges } from "@shared/wire";
import { cn } from "cn";
import { FileDiffIcon, MessageSquarePlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChangesHeader } from "@/components/ChangesHeader";
import { DisclosureChevron } from "@/components/Disclosure";
import { IconButton } from "@/components/IconButton";
import { RightSidebar } from "@/components/RightSidebar";
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
import { Spinner } from "@/components/ui/spinner";
import { workspaceChangedFile, workspaceChanges } from "@/lib/api";
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
  toggleEvery,
  toggleFile,
} from "@/lib/changesView";
import { type DiffFile, lineCount } from "@/lib/diff";
import { useChangesWrap } from "@/lib/useChangesWrap";
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

export function ChangesPanel({
  workspace,
  session,
  close,
  onAsk,
}: {
  workspace: Workspace | undefined;
  session: SessionView | null;
  close: () => void;
  /** Receives review text for the composer draft; the caller decides how to confirm. Omitted
   * while the draft takes no additions, which hides Ask. */
  onAsk: ((text: string) => void) | undefined;
}) {
  const { observation, error, busy, refresh } = useWorkspaceChanges(
    workspace,
    true,
    refreshKey(session),
  );
  const [disclosure, setDisclosure] = useState<Disclosure>(initialDisclosure);
  const sheet = changesSheet({ observation, error, busy, disclosure });
  const { body } = sheet;
  const ask = onAsk && ((loaded: LoadedFile) => onAsk(askText(loaded)));

  return (
    <RightSidebar
      label="Changes"
      title="Changes"
      close={close}
      header={
        <ChangesHeader
          sheet={sheet}
          canRefresh={!!workspace}
          refresh={refresh}
          toggleEvery={() => setDisclosure(toggleEvery(disclosure, sheet))}
          close={close}
        />
      }
    >
      <div className="flex flex-col">
        <SheetBodyView
          body={body}
          onOpenChange={(path, next) => setDisclosure((d) => toggleFile(d, path, next))}
          onAsk={ask}
        />
      </div>
    </RightSidebar>
  );
}

function SheetBodyView({
  body,
  onOpenChange,
  onAsk,
}: {
  body: SheetBody;
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
        <ItemGroup className="gap-0" aria-label="Changed files">
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
  const slash = file.path.lastIndexOf("/");
  const directory = file.path.slice(0, slash + 1);
  const filename = file.path.slice(slash + 1);
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
      className="border-b border-line"
      data-path={file.path}
    >
      {/* A flat row, not a card: files read as one list. Sticky within the sheet's scroll area so
       * the file name stays in view while its hunks scroll. */}
      <Item
        size="sm"
        className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1 gap-y-0 rounded-none bg-conversation px-2 py-1"
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-h-9 min-w-0 justify-start gap-2 whitespace-normal px-2 py-2 text-left font-normal aria-expanded:bg-transparent pointer-coarse:min-h-11"
            aria-label={`${file.path}${file.binary ? "" : `, ${file.additions} added, ${file.deletions} removed`}: ${open ? "collapse" : "expand"}`}
          >
            <span className="self-start">
              <DisclosureChevron open={open} />
            </span>
            <ItemContent className="min-w-0 gap-0">
              <ItemTitle className="block w-full min-w-0 line-clamp-none font-mono text-xs [overflow-wrap:anywhere]">
                {filename}
              </ItemTitle>
            </ItemContent>
            {!file.binary && (
              <span className="ml-auto shrink-0 self-start font-mono text-xs tabular-nums">
                <span className="text-ok">+{file.additions}</span>{" "}
                <span className="text-err">−{file.deletions}</span>
              </span>
            )}
          </Button>
        </CollapsibleTrigger>
        {canAsk && (
          <ItemActions>
            <IconButton
              label={`Ask about ${file.path}`}
              tooltip="Ask about this file"
              disabled={!onAsk}
              onClick={onAsk}
              className="pointer-coarse:size-11"
            >
              <MessageSquarePlusIcon />
            </IconButton>
          </ItemActions>
        )}
        {directory && (
          <Collapsible className="col-span-full min-w-0">
            <div className="flex min-w-0 items-center pr-2 pl-7">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-6 min-w-0 flex-1 justify-start px-0 text-ink-3 aria-expanded:bg-transparent pointer-coarse:min-h-11"
                  aria-label={`Full path for ${file.path}`}
                >
                  <span className="truncate font-mono text-xs font-normal">{directory}</span>
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="disclosure-content px-2 py-2 font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">
              {file.path}
            </CollapsibleContent>
          </Collapsible>
        )}
        {description && (
          <ItemDescription className="col-span-full line-clamp-none px-2 pb-1 text-xs [overflow-wrap:anywhere]">
            {description}
          </ItemDescription>
        )}
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
  const [wrap] = useChangesWrap();
  // Fixed-layout wrapping must still leave room for large line numbers (not just two digits).
  const digits = useMemo(() => {
    let largest = 99;
    for (const hunk of file.hunks)
      for (const line of hunk.lines) largest = Math.max(largest, line.old ?? 0, line.new ?? 0);
    return String(largest).length;
  }, [file]);
  return (
    <div className="overflow-x-auto border-t border-line">
      <table
        className={cn("w-full border-collapse font-mono text-xs leading-5", wrap && "table-fixed")}
        aria-label={`Diff of ${file.path}`}
      >
        <colgroup>
          <col style={{ width: `calc(${digits}ch + 1rem)` }} />
          <col style={{ width: `calc(${digits}ch + 1rem)` }} />
          <col />
        </colgroup>
        <tbody>
          {file.hunks.map((hunk, h) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a diff's hunks are positional and never reorder.
            <HunkRows key={h} hunk={hunk} wrap={wrap} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HunkRows({ hunk, wrap }: { hunk: DiffFile["hunks"][number]; wrap: boolean }) {
  return (
    <>
      <tr className="bg-fill text-ink-3">
        <td
          colSpan={3}
          className={cn(
            "select-none px-3 py-0.5",
            wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre",
          )}
        >
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
      ))}
    </>
  );
}
