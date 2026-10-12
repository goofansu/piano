import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

/**
 * Confirms removing setup from Pi on this machine. It stays mounted so it can animate closed;
 * the caller keeps the last subject's wording while it does.
 */
export function RemovalDialog({
  open,
  title,
  description,
  action,
  busy,
  disabled = busy,
  cancel,
  confirm,
}: {
  open: boolean;
  title: string;
  description: string;
  /** The confirm button's label, such as "Remove" or "Uninstall". */
  action: string;
  busy: boolean;
  /** Whether confirming is unavailable; defaults to `busy`. */
  disabled?: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) cancel();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={disabled}
            onClick={() => {
              if (open) confirm();
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
