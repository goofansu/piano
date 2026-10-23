import type { SessionPreview } from "@shared/wire";
import {
  AppWindowIcon,
  ChevronDownIcon,
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
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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

const toneColor: Record<PreviewTone, string> = {
  ready: "text-ok",
  pending: "text-muted-foreground",
  problem: "text-err",
  idle: "text-muted-foreground",
};
const toneBadge = {
  ready: "success",
  pending: "secondary",
  problem: "error",
  idle: "secondary",
} as const;

function PreviewIcon({ tone }: { tone: PreviewTone }) {
  return tone === "pending" ? (
    <Spinner data-icon="inline-start" aria-hidden />
  ) : (
    <AppWindowIcon data-icon="inline-start" className={toneColor[tone]} aria-hidden />
  );
}

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

/**
 * The session header's preview control, shown only while the selected session's live Pi owns an
 * app. A running app opens in one click; the chevron (or the whole control while it is not
 * answering) holds its status, details and Stop. Opening the menu re-observes the app.
 */
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

export function SessionPreviewControl() {
  const mobile = useIsMobile();
  const { state } = useCommands();
  const commands = usePreviewCommands();
  const preview = selectedPreview(state);
  if (!preview) return null;
  const face = previewFace(preview);
  const size = mobile ? "xs" : "lg";
  const menu = (
    <DropdownMenu modal={false} onOpenChange={(open) => open && previewObservation.refresh()}>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            {preview.url ? (
              <Button
                variant="ghost"
                size={mobile ? "icon-xs" : "icon-sm"}
                className="-ml-1.5"
                aria-label="Preview status and actions"
              >
                <ChevronDownIcon aria-hidden />
              </Button>
            ) : (
              <Button variant="ghost" size={size} aria-label={`Preview: ${face.status}`}>
                <PreviewIcon tone={face.tone} /> {face.label}
              </Button>
            )}
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent>Preview status and actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" collisionPadding={16} className="w-72">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-foreground">{face.status}</span>
          <span className="truncate font-normal text-muted-foreground">
            {preview.url
              ? previewHost(preview.url)
              : preview.detail || "No link while the app is not answering"}
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
            <ScrollTextIcon aria-hidden /> Details and logs
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!commands.canStop} onSelect={commands.stop}>
          <SquareIcon aria-hidden /> Stop preview
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  if (!preview.url) return menu;
  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size={size}>
            <a
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open preview, ${previewHost(preview.url)}, in a new tab`}
            >
              <PreviewIcon tone={face.tone} /> {face.label}
              <ExternalLinkIcon data-icon="inline-end" aria-hidden />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open {previewHost(preview.url)} in a new tab</TooltipContent>
      </Tooltip>
      {menu}
    </div>
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
  const face = previewFace(preview);
  return (
    <dl className="flex flex-col gap-2">
      <Fact label="Status">
        <StatusBadge variant={toneBadge[face.tone]}>{face.status}</StatusBadge>
      </Fact>
      <Fact label="Link">
        {preview.url ? (
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {preview.url}
          </a>
        ) : (
          <span className="text-muted-foreground">None while the app is not answering</span>
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
            The app this session started. It runs while this session’s Pi does; archiving or
            deleting the session stops it.
          </DialogDescription>
        </DialogHeader>
        {preview && (
          <div className="flex min-w-0 flex-col gap-4">
            <PreviewFacts preview={preview} />
            <section className="flex min-w-0 flex-col gap-2" aria-labelledby="preview-logs">
              <div className="flex items-center justify-between gap-2">
                <h3 id="preview-logs" className="text-sm font-medium">
                  Recent output
                </h3>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={observed.refreshing || !sessionReady(state)}
                  onClick={previewObservation.refresh}
                >
                  {observed.refreshing ? (
                    <Spinner data-icon="inline-start" aria-hidden />
                  ) : (
                    <RefreshCwIcon data-icon="inline-start" aria-hidden />
                  )}
                  Refresh
                </Button>
              </div>
              {details?.error && <p className="text-sm text-err">{details.error}</p>}
              {/* Plain preformatted output has no dedicated UI primitive. */}
              <pre className="max-h-64 min-h-16 overflow-auto rounded-md border border-line bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                {details?.logs.trim() ||
                  (observed.refreshing || !details ? "Reading output…" : "No output yet.")}
              </pre>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={!commands.canStop} onClick={commands.stop}>
            <SquareIcon data-icon="inline-start" aria-hidden /> Stop preview
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
