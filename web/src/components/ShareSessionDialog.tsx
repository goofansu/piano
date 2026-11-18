import { SHARE_UNCONFIRMED, SESSION_SHARE_TIMEOUT_MS, type SessionShare } from "@shared/share";
import { toast } from "sonner";
import { copyText } from "@/components/CopyButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Button } from "@/components/ui/button";
import { ApiError, shareSession } from "@/lib/api";
import { isLocalId } from "@/lib/machine";
import { openLink } from "@/lib/openLink";

export interface ShareTarget {
  machineId: string;
  machineName: string;
  workspaceId: string;
  sessionId: string;
  title: string;
}

export function ShareSessionDialog({
  target,
  close,
  openProviders,
}: {
  target: ShareTarget;
  close: () => void;
  openProviders: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Share to Radius</DialogTitle>
          <DialogDescription>The artifact is created with Private visibility.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              close();
              void share(target, openProviders);
            }}
          >
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function share(target: ShareTarget, openProviders: () => void) {
  const id = toast.loading("Sharing session", { description: target.title });
  const settled = { id, duration: Number.POSITIVE_INFINITY };
  try {
    const result = await shareSession(target.workspaceId, target.sessionId, {
      machineId: target.machineId,
      signal: AbortSignal.timeout(SESSION_SHARE_TIMEOUT_MS + 15_000),
    });
    if (result.status === "shared") shared(result.share, settled, false);
    else if (isLocalId(target.machineId))
      toast.warning("Sign in to Radius", {
        ...settled,
        description: "Then share again. Nothing was uploaded.",
        action: { label: "Open Providers", onClick: openProviders },
      });
    else
      toast.warning(`Sign in to Radius on ${target.machineName}`, {
        ...settled,
        description: `Open ${target.machineName}’s own Piano and sign in under Settings → Providers, then share again from here. The main Piano’s sign-in is not used. Nothing was uploaded.`,
      });
  } catch (error) {
    toast.error(
      error instanceof ApiError && error.status > 0 && error.status < 500
        ? error.message
        : SHARE_UNCONFIRMED,
      { ...settled, description: undefined },
    );
  }
}

function shared(
  result: SessionShare,
  settled: { id: string | number; duration: number },
  copied: boolean,
) {
  toast.success("Session shared", {
    ...settled,
    description: undefined,
    cancel: { label: "Open link", onClick: () => openLink(result.url) },
    action: {
      label: copied ? "Link copied" : "Copy link",
      onClick: (event) => {
        event.preventDefault();
        void copyText(result.url, "Could not copy the link.").then(
          (ok) => ok && shared(result, settled, true),
        );
      },
    },
  });
}
