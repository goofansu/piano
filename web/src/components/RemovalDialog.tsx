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
 * The one confirm dialog: removing setup from Pi on this machine (an install, a saved sign-in) and
 * the commands that ask first (archive or delete a session, close a folder, delete a project). It
 * keeps its label and turns a spinner while busy, and only Cancel or Escape dismiss it. It stays
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
  destructive = true,
  cancel,
  confirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  title: string;
  description: string;
  /** The confirm button's label, such as "Remove" or "Sign out". */
  action: string;
  /** The confirm button's label while the removal runs; defaults to `action`. */
  progress?: string;
  busy: boolean;
  /** Whether confirming is unavailable; defaults to `busy`. */
  disabled?: boolean;
  /** The confirm button is the red destructive one; false for a reversible step such as Archive. */
  destructive?: boolean;
  cancel: () => void;
  confirm: () => void;
  onCloseAutoFocus?: (event: Event) => void;
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
        onCloseAutoFocus={onCloseAutoFocus}
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
            variant={destructive ? "destructive" : "default"}
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
