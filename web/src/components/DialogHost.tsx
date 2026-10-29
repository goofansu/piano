import type { ClientCommand as ClientMessage, Dialog as PiDialog } from "@shared/wire";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Button } from "@/components/ui/button";
import type { PendingDialogs } from "@/lib/piDialogs";
import { useDialogAnswer } from "@/lib/useDialogAnswer";
import { useLastShown } from "@/lib/useLastShown";

/** Only the queue head may open a modal, and only for a confirmation. */
export function DialogHost({
  pending: { head, surface, more, connected },
  send,
}: {
  pending: PendingDialogs;
  send: (m: ClientMessage) => void;
}) {
  // The dialog animates closed after it leaves the queue, so it keeps the last question meanwhile.
  const confirmation = surface === "modal" ? head : undefined;
  const shown = useLastShown(confirmation);
  return shown ? (
    <DialogView
      key={`${shown.generation}/${shown.id}`}
      open={!!confirmation}
      d={shown}
      more={more}
      send={send}
      connected={connected}
    />
  ) : null;
}

function DialogView({
  open,
  d,
  more,
  send,
  connected,
}: {
  open: boolean;
  d: PiDialog;
  more: number;
  send: (m: ClientMessage) => void;
  connected: boolean;
}) {
  const { answer, cancel, abort, submitted, disabled, abortDisabled, title, deadline, waiting } =
    useDialogAnswer(d, connected, send, open);

  return (
    <Dialog open={open} onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">
            {d.message && (
              <>
                {d.message}
                {deadline && <br />}
              </>
            )}
            {deadline && (
              <>
                {deadline.label}: {deadline.remainingSeconds}s remaining.{" "}
                <time dateTime={new Date(deadline.at).toISOString()}>
                  {new Date(deadline.at).toLocaleTimeString()}
                </time>
                . Pi may have already closed this dialog; it sends no closure acknowledgement.
              </>
            )}
          </DialogDescription>
          {more > 0 && (
            <p className="text-sm text-ink-3">
              {more} more {more === 1 ? "question" : "questions"} after this one.
            </p>
          )}
        </DialogHeader>
        <fieldset disabled={disabled} className="contents">
          <DialogFooter>
            <Button variant="outline" onClick={() => answer({ confirmed: false })}>
              No
            </Button>
            <Button onClick={() => answer({ confirmed: true })}>Yes</Button>
          </DialogFooter>
        </fieldset>
        <div className="flex items-center gap-3 border-t border-line pt-3 text-xs text-ink-2">
          <Button variant="outline" size="sm" disabled={abortDisabled} onClick={abort}>
            Abort current
          </Button>
          <p>
            Cancels waiting dialogs and requests native abort. Pending queued input is not cleared.
          </p>
        </div>
        {submitted && (
          <p role="status" className="text-sm text-ink-2">
            {waiting}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
