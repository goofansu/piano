import type { SessionPreview } from "@shared/wire";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Button } from "@/components/ui/button";

/** Read-only, bounded diagnostics, not a terminal. Identity and observations arrive together
 * through the selected session's ordered stream, never from an unscoped request reply. */
export function PreviewDetails({
  preview,
  close,
  refresh,
}: {
  preview: SessionPreview | null | undefined;
  close: () => void;
  refresh: () => void;
}) {
  return (
    <Dialog open={!!preview} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Preview details</DialogTitle>
          <DialogDescription>
            Process: {preview?.state}. Local readiness:{" "}
            {preview?.ready === null ? "unknown" : preview?.ready ? "ready" : "not ready"}.
            {preview?.externalAccess === "same-host"
              ? " Link opens on this host."
              : " Authenticated external access is unverified."}
          </DialogDescription>
        </DialogHeader>
        {/* Plain diagnostic text has no dedicated shadcn primitive; never interpret logs as HTML. */}
        <div className="flex min-w-0 flex-col gap-3">
          {preview?.instanceId && (
            <p className="break-all text-xs text-muted-foreground">
              Instance: {preview.instanceId}
            </p>
          )}
          <p className="text-sm">
            {preview?.details?.detail ?? "Refresh to read current status and bounded logs."}
          </p>
          <section
            // biome-ignore lint/a11y/noNoninteractiveTabindex: bounded logs need keyboard scrolling.
            tabIndex={0}
            aria-label="Preview logs"
            className="max-h-64 overflow-auto"
          >
            <pre className="whitespace-pre-wrap break-all text-xs">
              {preview?.details?.logs || "No logs available."}
            </pre>
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Close
          </Button>
          <Button onClick={refresh}>Refresh preview</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
