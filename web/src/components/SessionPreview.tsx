import type { SessionPreview } from "@shared/wire";
import { cn } from "cn";
import {
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SquareIcon,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { useCommands, useSessionCommands } from "@/components/CommandHost";
import { IconButton } from "@/components/IconButton";
import { PianoButton } from "@/components/PianoButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import { RailList, RailRowTitle, railRow } from "@/components/SessionRailList";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { SurfaceFrame } from "@/components/SurfaceArea";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemMedia } from "@/components/ui/item";
import { previewObservation } from "@/lib/previewObservation";
import { sessionReady } from "@/lib/sessionContext";
import {
  type PreviewTone,
  previewAccess,
  previewFace,
  previewFrameUrl,
  previewHost,
  selectedPreview,
} from "@/lib/sessionPreview";
import { useNavigation } from "@/lib/useNavigation";

/** The app's state in the status dot's vocabulary; work in progress breathes. */
const dotTone: Record<PreviewTone, StatusTone> = {
  ready: "ok",
  pending: "busy",
  problem: "err",
  idle: "muted",
};

function usePreviewObservation() {
  return useSyncExternalStore(previewObservation.subscribe, previewObservation.getState);
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Preview link copied");
  } catch {
    toast.error("Couldn’t copy the preview link.");
  }
}

/** The selected session's preview commands, run through the host like any other surface's. */
function usePreviewCommands() {
  const { commands, run } = useSessionCommands();
  const find = (id: "preview-details" | "stop-preview") => commands.find((c) => c.id === id);
  const details = find("preview-details");
  const stop = find("stop-preview");
  return {
    details: () => details && run(details),
    stop: () => stop && run(stop),
    canStop: !!stop?.enabled,
  };
}

/** The dot and the word for the app's state, in Preview and its details. */
function PreviewStatus({ preview, className }: { preview: SessionPreview; className?: string }) {
  const face = previewFace(preview);
  return (
    <span className={className}>
      <StatusDot tone={dotTone[face.tone]} pulse={face.tone === "pending"} />
      {face.status}
    </span>
  );
}

/** One owned app in the rail; opening externally is a sibling, never row activation. */
export function PreviewRailRow({ preview }: { preview: SessionPreview }) {
  const navigation = useNavigation();
  const face = previewFace(preview);
  return (
    <RailList aria-label="App">
      <Item
        size="sm"
        data-row
        role="listitem"
        className={cn(
          railRow,
          rowActionsWidth.list[preview.url ? 1 : 0],
          "relative hover:bg-fill-hover focus-within:bg-fill-hover",
        )}
      >
        <button
          type="button"
          aria-label="Show preview"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none pointer-coarse:min-h-11"
          onClick={() => {
            navigation.openPreview();
            previewObservation.refresh();
          }}
        >
          <ItemMedia variant="icon">
            <StatusDot tone={dotTone[face.tone]} pulse={face.tone === "pending"} />
          </ItemMedia>
          <ItemContent data-motion="yield" className="min-w-0 gap-0">
            <RailRowTitle>Preview</RailRowTitle>
            <ItemDescription className="line-clamp-none block truncate font-mono text-xs text-ink-3">
              {preview.url ? previewHost(preview.url) : face.status}
            </ItemDescription>
          </ItemContent>
        </button>
        {preview.url && (
          <RowActions className="top-1/2 right-1 -translate-y-1/2">
            <PianoButton
              asChild
              variant="ghost"
              size="list"
              aria-label="Open preview in new tab"
              title="Open preview in new tab"
            >
              <a href={preview.url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon />
              </a>
            </PianoButton>
          </RowActions>
        )}
      </Item>
    </RailList>
  );
}

/** The current app in the existing Surface. Navigation never owns the service lifetime. */
export function PreviewPanel() {
  const { shownTab, surfaceRequest } = useNavigation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: repeated requests to show Preview are explicit observations too.
  useEffect(() => {
    if (shownTab === "preview") previewObservation.refresh();
  }, [shownTab, surfaceRequest]);
  const { state } = useCommands();
  const preview = selectedPreview(state);
  const commands = usePreviewCommands();
  const observed = usePreviewObservation();
  // Only a view that actually inspected this app can retain its confirmed stop. Closing the
  // tab discards this identity; browser memory never restores a Preview tab.
  const [viewedInstance, setViewedInstance] = useState(preview?.instanceId ?? null);
  if (preview && preview.instanceId !== viewedInstance) setViewedInstance(preview.instanceId);
  const stopped =
    !preview &&
    observed.terminal?.instanceId === viewedInstance &&
    observed.terminal?.cwd === state.session?.cwd &&
    observed.terminal?.sessionId === state.session?.sessionId;
  const url = previewFrameUrl(preview, window.location.origin);
  const actions = preview && (
    <>
      {preview.url && (
        <PianoButton asChild variant="ghost" size="sm">
          <a href={preview.url} target="_blank" rel="noopener noreferrer">
            Open in new tab
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </PianoButton>
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton size="header" label="More preview actions">
            <MoreHorizontalIcon />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {preview.url && (
              <DropdownMenuItem onSelect={() => void copyLink(preview.url!)}>
                <CopyIcon />
                Copy link
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={commands.details}>
              <ScrollTextIcon />
              Details
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={!commands.canStop}
              onSelect={commands.stop}
            >
              <SquareIcon className="fill-current" />
              Stop preview
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  if (url && preview)
    return (
      <EmbeddedPreview
        // SessionPanel fences the session. This boundary also disposes page state, timers and
        // callbacks on owner/instance/URL change, not on ordinary status reads or hide/show.
        key={JSON.stringify([state.session?.cursor?.generation, preview.instanceId, url])}
        url={url}
        preview={preview}
        actions={actions}
      />
    );
  return (
    <SurfaceFrame tab="preview" actions={actions}>
      <Empty>
        <EmptyHeader>
          {preview ? (
            <>
              <EmptyTitle>
                <PreviewStatus
                  preview={preview}
                  className="flex items-center justify-center gap-2"
                />
              </EmptyTitle>
              {preview.url && (
                <EmptyDescription className="break-all font-mono">
                  {previewHost(preview.url)}
                </EmptyDescription>
              )}
            </>
          ) : (
            <EmptyDescription>
              {stopped ? "Preview stopped" : "Preview unavailable"}
            </EmptyDescription>
          )}
        </EmptyHeader>
        {preview && !preview.url && (
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              disabled={observed.refreshing || !sessionReady(state)}
              aria-busy={observed.refreshing}
              onClick={previewObservation.refresh}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={observed.refreshing ? "animate-spin" : undefined}
              />
              Check status
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </SurfaceFrame>
  );
}

/** One registered page. Reload replaces only its browsing context, never its managed process. */
function EmbeddedPreview({
  url,
  preview,
  actions,
}: {
  url: string;
  preview: SessionPreview;
  actions: ReactNode;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState(0);
  const [loadingPage, setLoadingPage] = useState<number | null>(0);
  const loading = loadingPage === page;
  const reload = () => {
    setRecovery(false);
    setLoadingPage(page + 1);
    setPage(page + 1);
  };
  // An old iframe's queued load/error must not settle a later reload.
  const finish = () => setLoadingPage((current) => (current === page ? null : current));
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    // A load/error can be an opaque blocked/login page. Neither it nor this deadline says
    // anything about service health or successful embedding; just end the bounded feedback.
    const timer = setTimeout(
      () => setLoadingPage((current) => (current === page ? null : current)),
      8_000,
    );
    return () => clearTimeout(timer);
  }, [page]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each page is a different iframe DOM node.
  useLayoutEffect(() => {
    const element = frame.current;
    return () => {
      // Removing a focused cross-origin frame must not strand keyboard focus in a dead page.
      if (element && document.activeElement === element)
        element.closest<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true });
    };
  }, [page]);
  return (
    <SurfaceFrame
      tab="preview"
      actions={
        <>
          <IconButton size="header" label="Reload preview" aria-busy={loading} onClick={reload}>
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          </IconButton>
          {actions}
        </>
      }
    >
      {/* An iframe has no shadcn primitive. No proxy, DOM bridge or delegated device permissions.
          Scripts/origin/forms are the tested app's minimum; top navigation/popups stay denied. */}
      <div className="flex h-full min-h-0 flex-col">
        <iframe
          key={page}
          ref={frame}
          title="App preview"
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="no-referrer"
          onLoad={finish}
          onError={finish}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line pr-2 pl-4">
          <PreviewStatus preview={preview} className="flex items-center gap-2 text-xs text-ink-2" />
          <Popover open={recovery} onOpenChange={setRecovery}>
            <PopoverTrigger asChild>
              <PianoButton variant="ghost" size="sm">
                Preview not appearing?
              </PianoButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex flex-col gap-3">
              <PopoverDescription>
                Reload returns to the app’s entry page. Opening in a new tab may require sign-in.
              </PopoverDescription>
              <div className="flex flex-wrap gap-2">
                <PianoButton variant="outline" size="sm" onClick={reload}>
                  <RefreshCwIcon data-icon="inline-start" />
                  Reload preview
                </PianoButton>
                <PianoButton asChild variant="outline" size="sm">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    Open in new tab
                    <ExternalLinkIcon data-icon="inline-end" />
                  </a>
                </PianoButton>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </SurfaceFrame>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function PreviewFacts({ preview }: { preview: SessionPreview }) {
  return (
    <dl className="flex flex-col gap-2">
      <Fact label="Status">
        <PreviewStatus preview={preview} className="flex items-center gap-2" />
      </Fact>
      <Fact label="Link">
        {preview.url ? (
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs underline-offset-2 hover:underline"
          >
            {preview.url}
          </a>
        ) : (
          <span className="text-muted-foreground">None until the app answers</span>
        )}
      </Fact>
      {preview.url && <Fact label="Access">{previewAccess(preview)}</Fact>}
      <Fact label="Observed">{new Date(preview.observedAt * 1000).toLocaleString()}</Fact>
      {preview.detail && <Fact label="Last check">{preview.detail}</Fact>}
      {preview.command.length > 0 && (
        <Fact label="Command">
          <code className="font-mono text-xs">{preview.command.join(" ")}</code>
        </Fact>
      )}
    </dl>
  );
}

/**
 * The selected session's preview on demand: what was observed, the app's recent output, and its
 * actions. `instanceId` is the app it was opened for; it closes once that app is stopped, replaced
 * or its session ends, and never reopens for another one.
 */
export function PreviewDetailsDialog({
  instanceId,
  close,
}: {
  instanceId: string | null;
  close: () => void;
}) {
  const { state } = useCommands();
  const commands = usePreviewCommands();
  const observed = usePreviewObservation();
  const openRef = useRef<HTMLAnchorElement>(null);
  const preview = selectedPreview(state);
  const session = state.session;
  const details =
    preview &&
    observed.details?.cwd === session?.cwd &&
    observed.details?.sessionId === session?.sessionId &&
    observed.details?.instanceId === preview.instanceId
      ? observed.details
      : undefined;
  return (
    <Dialog
      open={!!preview && preview.instanceId === instanceId}
      onOpenChange={(o) => !o && close()}
    >
      <DialogContent
        className="sm:max-w-xl"
        // Land on the safe action, never Stop: opening the app, else the dialog itself.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (openRef.current ?? (event.currentTarget as HTMLElement | null))?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Preview</DialogTitle>
          <DialogDescription>
            Started by this session. It runs while the session’s Pi does.
          </DialogDescription>
        </DialogHeader>
        {preview && (
          <div className="flex min-w-0 flex-col gap-4">
            <PreviewFacts preview={preview} />
            <section className="flex min-w-0 flex-col gap-2" aria-labelledby="preview-logs">
              <div className="flex items-center justify-between gap-2">
                <h3 id="preview-logs" className="text-sm font-medium">
                  Output
                </h3>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-busy={observed.refreshing}
                  disabled={observed.refreshing || !sessionReady(state)}
                  onClick={previewObservation.refresh}
                >
                  <RefreshCwIcon
                    data-icon="inline-start"
                    className={observed.refreshing ? "animate-spin" : undefined}
                    aria-hidden
                  />
                  Refresh
                </Button>
              </div>
              {details?.error && <p className="text-sm text-err">{details.error}</p>}
              {/* Plain preformatted output has no dedicated UI primitive. */}
              <pre className="max-h-64 min-h-16 overflow-auto rounded-md border border-line bg-fill p-3 font-mono text-xs whitespace-pre-wrap break-words">
                {details?.logs.trim() ||
                  (observed.refreshing || !details ? "Reading output…" : "No output yet.")}
              </pre>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={!commands.canStop} onClick={commands.stop}>
            <SquareIcon data-icon="inline-start" className="fill-current" aria-hidden /> Stop
            preview
          </Button>
          {preview?.url && (
            <Button asChild>
              <a ref={openRef} href={preview.url} target="_blank" rel="noopener noreferrer">
                Open in new tab
                <ExternalLinkIcon data-icon="inline-end" aria-hidden />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
