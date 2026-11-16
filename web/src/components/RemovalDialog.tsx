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
  action: string;
  progress?: string;
  busy: boolean;
  disabled?: boolean;
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

export function signOutCopy(name: string | undefined) {
  return {
    title: `Sign out of ${name}?`,
    description: "Removes the saved sign-in from Pi on this machine.",
    action: "Sign out",
    progress: "Signing out…",
  };
}
