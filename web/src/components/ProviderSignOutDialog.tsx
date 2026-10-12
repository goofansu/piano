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

/** Shared confirmation for both provider management and Radius onboarding. */
export function ProviderSignOutDialog({
  name,
  busy,
  cancel,
  confirm,
}: {
  name: string;
  busy: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) cancel();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Sign out of {name}?</DialogTitle>
          <DialogDescription>Removes the saved sign-in from Pi on this machine.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={confirm}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "Signing out…" : "Sign out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
