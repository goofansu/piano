import { SHARE_UNCONFIRMED, SESSION_SHARE_TIMEOUT_MS, type SessionShare } from "@shared/share";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useCopy } from "@/components/CopyButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, shareSession } from "@/lib/api";
import { isLocalId } from "@/lib/machine";

export interface ShareTarget {
  machineId: string;
  machineName: string;
  workspaceId: string;
  sessionId: string;
  title: string;
}

type Phase =
  | { kind: "confirm" }
  | { kind: "pending" }
  | { kind: "sign-in-required" }
  | { kind: "failed"; error: string }
  | { kind: "shared"; result: SessionShare };

export function ShareSessionDialog({
  target,
  close,
  openProviders,
}: {
  target: ShareTarget;
  close: () => void;
  openProviders: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  const submitted = useRef(false);
  const busy = phase.kind === "pending";
  const submit = async () => {
    if (submitted.current) return;
    submitted.current = true;
    setPhase({ kind: "pending" });
    try {
      const result = await shareSession(target.workspaceId, target.sessionId, {
        machineId: target.machineId,
        signal: AbortSignal.timeout(SESSION_SHARE_TIMEOUT_MS + 15_000),
      });
      setPhase(
        result.status === "shared"
          ? { kind: "shared", result: result.share }
          : { kind: "sign-in-required" },
      );
    } catch (error) {
      setPhase({
        kind: "failed",
        error:
          error instanceof ApiError && error.status > 0 && error.status < 500
            ? error.message
            : SHARE_UNCONFIRMED,
      });
    }
  };
  const asking = phase.kind === "confirm" || busy;
  const local = isLocalId(target.machineId);
  const description =
    phase.kind === "shared"
      ? `${AUDIENCE[phase.result.visibility]} · Expires ${DAY.format(new Date(phase.result.expiresAt))}`
      : phase.kind === "sign-in-required"
        ? local
          ? "Sign in under Settings → Providers, then share again. Nothing was uploaded."
          : `Open ${target.machineName}’s own Piano and sign in under Settings → Providers, then share again from here. The main Piano’s sign-in is not used. Nothing was uploaded.`
        : phase.kind === "failed"
          ? undefined
          : target.title;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) close();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!asking}
        onInteractOutside={(event) => event.preventDefault()}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>
            {asking
              ? "Share session?"
              : phase.kind === "shared"
                ? "Session shared"
                : phase.kind === "sign-in-required"
                  ? local
                    ? "Sign in to Radius"
                    : `Sign in to Radius on ${target.machineName}`
                  : "Share session"}
          </DialogTitle>
          {description && (
            <DialogDescription
              className={asking ? "truncate" : undefined}
              title={asking ? target.title : undefined}
            >
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {asking && (
          <dl className="flex flex-col gap-2 text-sm">
            <Fact label="Uploads">
              Everything saved, unredacted: branches, instructions, tool output, attachments and any
              secrets in them
            </Fact>
            <Fact label="Visible to">
              {target.machineName}’s Radius organization default, which may be public
            </Fact>
          </dl>
        )}
        {phase.kind === "shared" && <ShareLink url={phase.result.url} />}
        {phase.kind === "failed" && (
          <Alert variant="destructive">
            <AlertDescription>{phase.error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          {asking ? (
            <>
              <Button variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void submit()}>
                {busy && <Spinner data-icon="inline-start" />}
                Share
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" autoFocus={phase.kind !== "shared"} onClick={close}>
                Done
              </Button>
              {phase.kind === "sign-in-required" && local && (
                <Button
                  onClick={() => {
                    close();
                    openProviders();
                  }}
                >
                  Open Providers
                </Button>
              )}
              {phase.kind === "shared" && (
                <Button asChild>
                  <a href={phase.result.url} target="_blank" rel="noopener noreferrer">
                    Open link
                    <ExternalLinkIcon data-icon="inline-end" aria-hidden />
                  </a>
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const AUDIENCE = { private: "Private", organization: "Organization", public: "Public" };
const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function ShareLink({ url }: { url: string }) {
  const { copied, copy } = useCopy(url, "Could not copy the link. Select it to copy it.");
  const label = copied ? "Link copied" : "Copy link";
  return (
    <InputGroup>
      <InputGroupInput
        aria-label="Share link"
        className="font-mono md:text-xs"
        value={url}
        readOnly
        spellCheck={false}
        onFocus={(event) => event.target.select()}
      />
      <InputGroupAddon align="inline-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton size="icon-sm" aria-label={label} autoFocus onClick={copy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </InputGroupAddon>
    </InputGroup>
  );
}
