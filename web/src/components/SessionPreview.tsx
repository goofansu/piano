import type { SessionPreview } from "@shared/wire";
import {
  AppWindowIcon,
  CopyIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SquareIcon,
} from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useCommands, useSessionCommands } from "@/components/CommandHost";
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
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { previewObservation } from "@/lib/previewObservation";
import { sessionReady } from "@/lib/sessionContext";
import {
  type PreviewTone,
  previewAccess,
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
 * the app's host (or its state while there is no link). It always opens the menu: status, Open,
 * Copy link, Details and Stop. Opening the menu re-observes the app.
 */
export function SessionPreviewControl() {
  const mobile = useIsMobile();
  const { state } = useCommands();
  const commands = usePreviewCommands();
  const preview = selectedPreview(state);
  if (!preview) return null;
  const face = previewFace(preview);
  const label = preview.url ? previewHost(preview.url) : face.label;
  return (
    <DropdownMenu modal={false} onOpenChange={(open) => open && previewObservation.refresh()}>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size={mobile ? "icon-sm" : "sm"}
              className={mobile ? "size-11" : "max-w-48 gap-2 font-normal"}
              aria-label={`Preview: ${face.status}. Status and actions`}
            >
              <AppWindowIcon
                className={iconColor[face.tone]}
                data-motion={face.tone === "pending" ? "pulse" : undefined}
                aria-hidden
              />
              {!mobile && <span className="truncate font-mono text-xs text-ink-2">{label}</span>}
            </Button>
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
          {preview.url && (
            <>
              <DropdownMenuItem asChild>
                <a href={preview.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon aria-hidden /> Open preview
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyLink(preview.url!)}>
                <CopyIcon aria-hidden /> Copy link
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={commands.details}>
            <ScrollTextIcon aria-hidden /> Details
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!commands.canStop} onSelect={commands.stop}>
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
                Open preview
                <ExternalLinkIcon data-icon="inline-end" aria-hidden />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
