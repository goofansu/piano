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
import { useLastShown } from "@/lib/useLastShown";

/**
 * Confirms removing setup from Pi on this machine: an install, or a saved sign-in. It stays
 * mounted so it can animate closed, and keeps its last open face meanwhile: a run that settles
 * and closes it in one update still exits showing its progress, with its buttons disabled.
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
  const live = { title, description, action, progress, busy, disabled };
  const face = useLastShown(open ? live : undefined) ?? live;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Live, not kept: whether cancelling is allowed is behaviour, not face.
        if (!next && !busy) cancel();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{face.title}</DialogTitle>
          <DialogDescription>{face.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={face.busy} onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={face.disabled}
            onClick={() => {
              if (open) confirm();
            }}
          >
            {face.busy && <Spinner data-icon="inline-start" />}
            {face.busy ? face.progress : face.action}
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
