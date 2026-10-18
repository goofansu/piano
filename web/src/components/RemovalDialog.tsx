import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Confirms removing setup from Pi on this machine: an install, or a saved sign-in. It stays
 * mounted so it can animate closed.
 */
export function RemovalDialog({
  open,
  title,
  description,
  action,
  progress = action,
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
  /** The confirm button's label while the removal runs; defaults to `action`. */
  progress?: string;
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
            {busy ? progress : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The wording that confirms signing out of `name`, a provider or an MCP server. */
export function signOutCopy(name: string | undefined) {
  return {
    title: `Sign out of ${name}?`,
    description: "Removes the saved sign-in from Pi on this machine.",
    action: "Sign out",
    progress: "Signing out…",
  };
}
