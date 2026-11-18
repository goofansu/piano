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
  machineUrl?: string;
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
    else signInRequired(target, settled, openProviders);
  } catch (error) {
    toast.error(
      error instanceof ApiError && error.status > 0 && error.status < 500
        ? error.message
        : SHARE_UNCONFIRMED,
      { ...settled, description: undefined },
    );
  }
}

function signInRequired(
  target: ShareTarget,
  settled: { id: string | number; duration: number },
  openProviders: () => void,
) {
  const local = isLocalId(target.machineId);
  const peerUrl = target.machineUrl;
  const providers = local
    ? openProviders
    : peerUrl
      ? () => openLink(new URL("/settings/providers", peerUrl).href)
      : undefined;
  toast.warning("Cannot share", {
    ...settled,
    description: local
      ? "Sign in Radius to share."
      : `Sign in Radius on ${target.machineName} to share.`,
    action: providers ? { label: "Providers", onClick: providers } : undefined,
  });
}

function shared(
  result: SessionShare,
  settled: { id: string | number; duration: number },
  copied: boolean,
) {
  toast.success("Session shared", {
    ...settled,
    description: undefined,
    cancel: (
      <button type="button" data-button data-cancel onClick={() => openLink(result.url)}>
        Open link
      </button>
    ),
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
