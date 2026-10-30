import type { SessionPreview } from "@shared/wire";
import {
  AppWindowIcon,
  CopyIcon,
  ExternalLinkIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { SurfaceFrame } from "@/components/SurfaceArea";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useIsMobile } from "@/hooks/use-mobile";
import { previewObservation } from "@/lib/previewObservation";
import { sessionReady } from "@/lib/sessionContext";
import {
  PREVIEW_FRAME_SANDBOX,
  type PreviewTone,
  previewAccess,
  previewDraft,
  previewFace,
  previewHost,
  selectedPreview,
} from "@/lib/sessionPreview";

/** The app's state in the status dot's vocabulary; work in progress breathes. */
const dotTone: Record<PreviewTone, StatusTone> = {
  ready: "ok",
  pending: "busy",
  problem: "err",
  idle: "muted",
};
const iconColor: Record<PreviewTone, string> = {
  ready: "text-ok",
  pending: "text-busy",
  problem: "text-err",
  idle: "text-ink-3",
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

/** The dot and the word for the app's state, as the header, the menu and the details show it. */
function PreviewStatus({ preview, className }: { preview: SessionPreview; className?: string }) {
  const face = previewFace(preview);
  return (
    <span className={className}>
      <StatusDot tone={dotTone[face.tone]} pulse={face.tone === "pending"} />
      {face.status}
    </span>
  );
}

/**
 * The session header's preview control, shown only while the selected session's live Pi owns an
 * app: the app icon in the state's colour, breathing while the app starts or stops, and on desktop
 * the app's host (or its state while there is no link). It always opens the menu: status, Open
 * preview (beside the conversation when there is room, otherwise a new tab), Open in new tab on
 * a wide session, Copy link, Details and Stop. Opening the menu re-observes the app.
 */
export function SessionPreviewControl() {
  const mobile = useIsMobile();
  const { state } = useCommands();
  const { commands, run } = useSessionCommands();
  const previewActions = usePreviewCommands();
  const open = commands.find((c) => c.id === "open-preview");
  const external = commands.find((c) => c.id === "open-preview-tab");
  const preview = selectedPreview(state);
  if (!preview) return null;
  const face = previewFace(preview);
  const label = preview.url ? previewHost(preview.url) : face.label;
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(menuOpen) => menuOpen && previewObservation.refresh()}
    >
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <PianoButton
              variant="ghost"
              size={mobile ? "icon-sm" : "sm"}
              trailing
              className={mobile ? "size-11" : "max-w-48"}
              aria-label={`Preview: ${face.status}. Status and actions`}
            >
              {/* The PR trigger's size and colour beside it; mono, as every host and branch is. */}
              <AppWindowIcon
                data-icon={mobile ? undefined : "inline-start"}
                className={iconColor[face.tone]}
                data-motion={face.tone === "pending" ? "pulse" : undefined}
                aria-hidden
              />
              {!mobile && <span className="truncate font-mono">{label}</span>}
            </PianoButton>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent>Preview: {face.status}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" collisionPadding={16} className="w-72">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <PreviewStatus preview={preview} className="flex items-center gap-2 text-foreground" />
          <span className="truncate font-mono font-normal text-muted-foreground">
            {preview.url ? preview.url : preview.detail || "No link until the app answers"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {open?.enabled && open.intent.kind === "open-url" && (
            <DropdownMenuItem asChild>
              <a href={open.intent.url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon aria-hidden /> Open preview
              </a>
            </DropdownMenuItem>
          )}
          {open?.enabled && open.intent.kind === "open-preview" && (
            <DropdownMenuItem onSelect={() => run(open)}>
              <AppWindowIcon aria-hidden /> Open preview
            </DropdownMenuItem>
          )}
          {external?.enabled && external.intent.kind === "open-url" && (
            <DropdownMenuItem asChild>
              <a href={external.intent.url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon aria-hidden /> Open in new tab
              </a>
            </DropdownMenuItem>
          )}
          {preview.url && (
            <DropdownMenuItem onSelect={() => void copyLink(preview.url!)}>
              <CopyIcon aria-hidden /> Copy link
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={previewActions.details}>
            <ScrollTextIcon aria-hidden /> Details
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!previewActions.canStop} onSelect={previewActions.stop}>
          <SquareIcon className="fill-current" aria-hidden /> Stop preview
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

/**
 * The selected session's app, in the Surface area. The frame is the registered entry URL on
 * another origin. Opening, closing and reloading it never starts, stops or restarts the app;
 * reload returns to that entry page, because the frame's current route is not visible from here.
 * A new session or a replaced instance mounts a new frame, so an old app is never shown under a
 * new label.
 */
export function SessionPreviewPanel({
  workspace,
  shown,
  onAsk,
}: {
  workspace: string;
  /** On screen: re-observe once, the same read the menu takes. A hidden tab keeps its frame. */
  shown: boolean;
  /** Adds the entry page to the draft. Omitted while the draft takes no additions. */
  onAsk: ((text: string) => void) | undefined;
}) {
  const { state } = useCommands();
  const preview = selectedPreview(state);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (shown) previewObservation.refresh();
  }, [shown]);
  const url = preview?.url ?? null;
  const face = preview ? previewFace(preview) : null;
  const host = url ? previewHost(url) : null;
  const ask = onAsk && url ? () => onAsk(previewDraft(url, workspace)) : undefined;
  return (
    <SurfaceFrame
      tab="preview"
      status={
        host ? (
          <span className="min-w-0 truncate font-mono">{host}</span>
        ) : (
          <span className="min-w-0 truncate">{face?.status ?? "No preview"}</span>
        )
      }
      actions={
        <>
          <IconButton size="header" label="Ask about this preview" disabled={!ask} onClick={ask}>
            <MessageSquarePlusIcon />
          </IconButton>
          <IconButton
            size="header"
            label="Reload preview"
            disabled={!url}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCwIcon />
          </IconButton>
          {url && (
            <Tooltip>
              <TooltipTrigger asChild>
                <PianoButton asChild variant="ghost" size="header">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open in new tab"
                  >
                    <ExternalLinkIcon />
                  </a>
                </PianoButton>
              </TooltipTrigger>
              <TooltipContent>Open in new tab</TooltipContent>
            </Tooltip>
          )}
        </>
      }
    >
      {url && preview ? (
        // No shadcn primitive is a cross-origin app frame. The sandbox lets the app run as
        // itself and withholds navigation of this page.
        <iframe
          key={`${preview.instanceId}:${url}:${reload}`}
          title={`Preview ${host}`}
          src={url}
          referrerPolicy="no-referrer"
          sandbox={PREVIEW_FRAME_SANDBOX}
          className="absolute inset-0 h-full w-full border-0 bg-surface-1"
        />
      ) : (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AppWindowIcon />
            </EmptyMedia>
            <EmptyTitle>{face?.status ?? "No preview"}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </SurfaceFrame>
  );
}
