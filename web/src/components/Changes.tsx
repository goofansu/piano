import type { ChangeFile, ChangesScope, Comparison, Workspace } from "@shared/wire";
import { cn } from "cn";
import { FileDiffIcon, GitPullRequestIcon, MessageSquarePlusIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
import { type DiffFile, lineCount } from "@/lib/diff";
import { useMachineId } from "@/lib/useMachine";
import { useObservation } from "@/lib/useObservation";
import type { SessionView } from "@/store";

type ReadFile = (path: string, signal: AbortSignal) => Promise<LoadedFile>;

function useSessionChanges(
  workspace: Workspace | undefined,
  sessionId: string | null | undefined,
  active: boolean,
  refreshKey: string,
) {
  const machineId = useMachineId();
  const key =
    workspace && sessionId ? JSON.stringify([workspace.id, workspace.path, sessionId]) : null;
  const { value, failure, loading, mutating, refresh, mutate } = useObservation<ShownChanges>(
    key,
    async (signal) =>
      checkWorkspaceResponse(
        workspace!,
        await sessionChanges(workspace!.id, sessionId!, undefined, { signal, machineId }),
      ),
    { enabled: active, focus: true, trigger: refreshKey, debounce: 600 },
  );
  const setScope = (scope: ChangesScope) =>
    mutate(async (signal) =>
      checkWorkspaceResponse(
        workspace!,
        await setSessionChangesScope(workspace!.id, sessionId!, scope, { signal, machineId }),
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
          { signal, machineId },
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
  unavailable: string | undefined;
  session: SessionView | null;
  active: boolean;
  onAsk: ((text: string) => void) | undefined;
  pullRequest: PullRequestControl;
}) {
  const { observation, error, busy, refresh, setScope, readFile } = useSessionChanges(
    unavailable ? undefined : workspace,
    session?.sessionId,
    active && !unavailable,
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
              disabled={!pullRequest.changeable || pullRequest.busy}
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
  canAsk: boolean;
  onAsk?: () => void;
  message?: string;
  retry?: () => void;
}) {
  const large = isLarge(file);
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
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1 bg-conversation px-2 py-1">
          <CollapsibleTrigger
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

const CodePatch = lazy(() =>
  import("@/components/Code").then(
    ({ CodePatch }) => ({ default: CodePatch }),
    () => ({
      default: () => (
        <p className="border-t border-line px-3 py-2 text-xs text-ink-3">
          Could not load the diff viewer. Reload Piano and try again.
        </p>
      ),
    }),
  ),
);

function Hunks({ file }: { file: DiffFile }) {
  return (
    <Suspense fallback={null}>
      <CodePatch patch={file.raw} label={`Diff of ${file.path}`} />
    </Suspense>
  );
}
