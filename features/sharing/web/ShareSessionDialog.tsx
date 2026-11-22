import {
  SHARE_UNCONFIRMED,
  SESSION_SHARE_TIMEOUT_MS,
  type SessionShare,
} from "@features/sharing/contracts/share";
import { shareSession } from "@features/sharing/web/sharingApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/shared/components/CopyButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  type DialogFinalFocus,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/PianoDialog";
import { ApiError } from "@/shared/transport/api";
import { openLink } from "./openLink";

export interface ShareTarget {
  workspaceId: string;
  sessionId: string;
  title: string;
}

export function ShareSessionDialog({
  target,
  close,
  openSettings,
  finalFocus,
}: {
  target: ShareTarget;
  close: () => void;
  openSettings: OpenSettings;
  finalFocus?: DialogFinalFocus;
}) {
  return (
    <Dialog open disablePointerDismissal onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} finalFocus={finalFocus}>
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
              void share(target, openSettings);
            }}
          >
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OpenSettings = (section: "providers") => void;

async function share(target: ShareTarget, openSettings: OpenSettings) {
  const id = toast.loading("Sharing session", { description: target.title });
  const settled = { id, duration: Number.POSITIVE_INFINITY };
  try {
    const result = await shareSession(target.workspaceId, target.sessionId, {
      signal: AbortSignal.timeout(SESSION_SHARE_TIMEOUT_MS + 15_000),
    });
    if (result.status === "shared") shared(result.share, settled, false);
    else signInRequired(settled, openSettings);
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
  settled: { id: string | number; duration: number },
  openSettings: OpenSettings,
) {
  toast.warning("Cannot share", {
    ...settled,
    description: "Sign in Radius to share.",
    action: { label: "Providers", onClick: () => openSettings("providers") },
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
