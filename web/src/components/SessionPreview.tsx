import type { SessionPreview } from "@shared/wire";
import { cn } from "cn";
import {
  ExternalLinkIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SquareIcon,
} from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import {
  CommandLink,
  useCommands,
  useOpenPreview,
  useSessionCommands,
} from "@/components/CommandHost";
import { IconButton } from "@/components/IconButton";
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
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import { RailList, RailRowTitle, railRow } from "@/components/SessionRailList";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription } from "@/components/ui/item";
import { previewObservation, seenDetails, seenPreview } from "@/lib/previewObservation";
import { sessionReady } from "@/lib/sessionContext";
import {
  type PreviewClaim,
  type PreviewTone,
  previewAccess,
  previewClaimHolds,
  previewFace,
} from "@/lib/sessionPreview";
import type { AppState } from "@/store";

/** The app's state in the status dot's vocabulary; work in progress breathes. */
export const dotTone: Record<PreviewTone, StatusTone> = {
  ready: "ok",
  pending: "busy",
  problem: "err",
  idle: "muted",
};

function usePreviewObservation() {
  return useSyncExternalStore(previewObservation.subscribe, previewObservation.getState);
}

/** The selected session's app as this page sees it; see `seenPreview`. */
export function useSeenPreview(state: AppState) {
  return seenPreview(state, usePreviewObservation());
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
export function PreviewStatus({
  preview,
  className,
}: {
  preview: SessionPreview;
  className?: string;
}) {
  const face = previewFace(preview);
  return (
    <span className={className}>
      <StatusDot tone={dotTone[face.tone]} />
      {face.status}
    </span>
  );
}

/** One owned app in the rail; opening it never changes session navigation. */
export function PreviewRailRow({ preview }: { preview: SessionPreview }) {
  const commands = usePreviewCommands();
  const openPreview = useOpenPreview();
  const handOff = useRef(false);
  return (
    <RailList aria-label="App">
      <Item
        size="sm"
        data-row
        role="listitem"
        className={cn(
          railRow,
          rowActionsWidth.list[1],
          "relative hover:bg-fill-hover focus-within:bg-fill-hover",
        )}
      >
        <ItemContent data-motion="yield" className="min-w-0 gap-0">
          <RailRowTitle>
            <PreviewStatus preview={preview} className="flex items-center gap-2" />
          </RailRowTitle>
          {openPreview && (
            <ItemDescription className="line-clamp-none block truncate font-mono text-xs text-ink-3">
              <CommandLink
                command={openPreview}
                aria-label={openPreview.label}
                className="inline-flex max-w-full items-center gap-1 hover:underline"
              >
                <span className="truncate">{openPreview.detail}</span>
                <ExternalLinkIcon className="size-3 shrink-0" />
              </CommandLink>
            </ItemDescription>
          )}
        </ItemContent>
        <RowActions className="top-1/2 right-1 -translate-y-1/2">
          <DropdownMenu
            modal={false}
            onOpenChange={(open) => {
              if (open) {
                handOff.current = false;
                previewObservation.refresh();
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <IconButton size="list" label="More preview actions">
                <MoreHorizontalIcon />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (handOff.current) event.preventDefault();
              }}
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onSelect={() => {
                    handOff.current = true;
                    commands.details();
                  }}
                >
                  <ScrollTextIcon />
                  Preview details
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!commands.canStop}
                  onSelect={() => {
                    handOff.current = true;
                    commands.stop();
                  }}
                >
                  <SquareIcon className="fill-current" />
                  Stop preview
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </RowActions>
      </Item>
    </RailList>
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
 * actions. `claim` is the app it was opened for; it closes once that app is stopped, replaced, its
 * Pi restarted or its session left, and never reopens for another one.
 */
export function PreviewDetailsDialog({
  claim,
  close,
  onCloseAutoFocus,
}: {
  claim: PreviewClaim | null;
  close: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { state } = useCommands();
  const commands = usePreviewCommands();
  const openPreview = useOpenPreview();
  const observed = usePreviewObservation();
  const openRef = useRef<HTMLAnchorElement>(null);
  const preview =
    claim && previewClaimHolds(state, claim) ? seenPreview(state, observed) : undefined;
  const details = seenDetails(state, observed);
  return (
    <Dialog open={!!preview} onOpenChange={(o) => !o && close()}>
      <DialogContent
        // Bounded to the viewport so Close and the footer stay reachable on a short screen.
        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={onCloseAutoFocus}
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
              {/* Plain preformatted output has no dedicated UI primitive. The scroll container
                  wraps the <pre> instead of being it: when a scrollable <pre> is dragged over in
                  Firefox, the selection jumps to the whole dialog each time the pointer crosses
                  the gap between two lines. */}
              <div className="max-h-[min(16rem,40dvh)] min-h-16 overflow-auto rounded-md border border-line bg-fill">
                <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words">
                  {details?.logs.trim() ||
                    (observed.refreshing || !details ? "Reading output…" : "No output yet.")}
                </pre>
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!preview || !commands.canStop}
            onClick={commands.stop}
          >
            <SquareIcon data-icon="inline-start" className="fill-current" aria-hidden /> Stop
            preview
          </Button>
          {preview && openPreview && (
            <Button asChild>
              <CommandLink ref={openRef} command={openPreview}>
                {openPreview.label}
                <ExternalLinkIcon data-icon="inline-end" aria-hidden />
              </CommandLink>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
