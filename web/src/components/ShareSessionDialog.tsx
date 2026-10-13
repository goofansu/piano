import type { SessionShare } from "@shared/share";
import { CopyIcon, ExternalLinkIcon, InfoIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { shareSession } from "@/lib/api";
import { canShareSession, type SessionTarget } from "@/lib/sessionCommands";
import { workspaceFor } from "@/lib/sessionContext";
import type { AppState } from "@/store";

export function ShareSessionDialog({
  target,
  state,
  signedIn,
  close,
}: {
  target: SessionTarget;
  state: AppState;
  signedIn: boolean;
  close: () => void;
}) {
  const [result, setResult] = useState<SessionShare>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const workspace = workspaceFor(state, target.cwd);
  const allowed = signedIn && canShareSession(state, target) && !!workspace;
  const publish = async () => {
    if (started.current || !allowed || !workspace) return;
    started.current = true;
    setBusy(true);
    try {
      setResult(await shareSession(workspace.id, target.sessionId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sharing could not be confirmed. Check Radius artifacts before sharing again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success("Share link copied");
    } catch {
      toast.error("Couldn’t copy the link. Select and copy it below.");
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{result ? "Session shared" : "Share session"}</DialogTitle>
          <DialogDescription>
            {result
              ? "Members of your Radius organization can view this snapshot."
              : "Share a saved snapshot with your Radius organization."}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="session-share-link">Share link</FieldLabel>
              <Input
                id="session-share-link"
                value={result.url}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <p className="text-sm text-muted-foreground">
                Expires {new Date(result.expiresAt).toLocaleDateString()}.
              </p>
            </Field>
          </FieldGroup>
        ) : (
          <Alert role="note">
            <InfoIcon />
            <AlertTitle>Check for secrets</AlertTitle>
            <AlertDescription>Includes instructions, tool output and attachments.</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!signedIn && !result && !busy && !error && (
          <Alert>
            <AlertDescription>Sign in to Radius in Providers before sharing.</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            {result || error ? "Done" : "Cancel"}
          </Button>
          {result ? (
            <>
              <Button variant="outline" asChild>
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon data-icon="inline-start" /> Open
                </a>
              </Button>
              <Button onClick={() => void copy()}>
                <CopyIcon data-icon="inline-start" /> Copy link
              </Button>
            </>
          ) : (
            !error && (
              <Button disabled={!allowed || busy} onClick={() => void publish()}>
                {busy && <Spinner data-icon="inline-start" />}
                {busy ? "Sharing…" : "Share"}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
