import { SHARE_UNCONFIRMED, SESSION_SHARE_TIMEOUT_MS, type SessionShare } from "@shared/share";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useCopy } from "@/components/CopyButton";
import { FormDialog } from "@/components/FormDialog";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { RemovalDialog } from "@/components/RemovalDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  if (phase.kind === "confirm" || busy)
    return (
      <RemovalDialog
        open
        title="Share session?"
        description={`Upload the full saved JSONL for “${target.title}” on ${target.machineName} to Radius, including all saved branches, instructions, tool output and attachments, without redaction. It may contain secrets. Uses ${target.machineName}’s Radius sign-in and that organization’s default visibility, which may be public. Each share creates a new artifact.`}
        action="Share session"
        busy={busy}
        destructive={false}
        cancel={close}
        confirm={() => void submit()}
      />
    );
  return (
    <FormDialog close={close} className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{phase.kind === "shared" ? "Session shared" : "Share session"}</DialogTitle>
        <DialogDescription>
          {target.title} · {target.machineName}
        </DialogDescription>
      </DialogHeader>
      {phase.kind === "shared" && <ShareLink result={phase.result} />}
      {phase.kind === "failed" && (
        <Alert variant="destructive">
          <AlertDescription>{phase.error}</AlertDescription>
        </Alert>
      )}
      {phase.kind === "sign-in-required" && (
        <Alert>
          <AlertDescription>
            {isLocalId(target.machineId)
              ? "Sign in to Radius in Settings → Providers, then share again. Nothing was uploaded."
              : `Sign in to Radius on ${target.machineName}: open that machine’s Piano directly and go to Settings → Providers. Then return here and share again. The main Piano’s sign-in is not used. Nothing was uploaded.`}
          </AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          Done
        </Button>
        {phase.kind === "sign-in-required" && isLocalId(target.machineId) && (
          <Button
            onClick={() => {
              close();
              openProviders();
            }}
          >
            Open Providers
          </Button>
        )}
      </DialogFooter>
    </FormDialog>
  );
}

function ShareLink({ result }: { result: SessionShare }) {
  const { copied, copy } = useCopy(
    result.url,
    "Could not copy the link. Select and copy it below.",
  );
  const audience = { private: "Private", organization: "Organization", public: "Public" }[
    result.visibility
  ];
  return (
    <Field>
      <FieldLabel htmlFor="session-share-link">Share link</FieldLabel>
      <Input
        id="session-share-link"
        value={result.url}
        readOnly
        onFocus={(event) => event.target.select()}
      />
      <FieldDescription>
        {audience} · Expires {new Date(result.expiresAt).toLocaleDateString()}
      </FieldDescription>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button variant="outline" asChild>
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            Open link
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </Button>
      </div>
    </Field>
  );
}
