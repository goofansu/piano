import { CheckIcon, CopyIcon, ExternalLinkIcon, InfoIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import type { SharePhase } from "@/lib/commandForms";

/** Renders the share form's phase; the command host's forms publish (once) and close it. */
export function ShareSessionDialog({
  open,
  phase,
  allowed,
  signedIn,
  submit,
  close,
}: {
  open: boolean;
  phase: SharePhase;
  allowed: boolean;
  signedIn: boolean;
  submit: () => void;
  close: () => void;
}) {
  const result = phase.phase === "shared" ? phase.share : undefined;
  const error = phase.phase === "failed" ? phase.error : undefined;
  const busy = phase.phase === "publishing";
  // The copy confirmation is the dialog's own: it never reaches the form.
  const [copied, setCopied] = useState(false);
  // The dialog stays mounted between shares, so a new share starts uncopied.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCopied(false);
  }
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
    } catch {
      setCopied(false);
      toast.error("Couldn’t copy the link. Select and copy it below.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!!result}
        aria-describedby={result ? undefined : "share-session-description"}
      >
        <DialogHeader>
          <DialogTitle>{result ? "Session shared" : "Share session"}</DialogTitle>
          {!result && (
            <DialogDescription id="share-session-description">
              Share a snapshot with your Radius organization. Reuses the same link when available.
            </DialogDescription>
          )}
        </DialogHeader>
        {result ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="session-share-link">Share link</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="session-share-link"
                  value={result.url}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <InputGroupAddon align="inline-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InputGroupButton
                        size="icon-sm"
                        aria-label="Copy link"
                        onClick={() => void copy()}
                      >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>{copied ? "Copied" : "Copy link"}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InputGroupButton size="icon-sm" asChild>
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open shared session"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExternalLinkIcon />
                        </a>
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>Open shared session</TooltipContent>
                  </Tooltip>
                  <span className="sr-only" role="status">
                    {copied ? "Link copied" : ""}
                  </span>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                Expires {new Date(result.expiresAt).toLocaleDateString()}.
              </FieldDescription>
            </Field>
          </FieldGroup>
        ) : (
          <Alert role="note">
            <InfoIcon />
            <AlertTitle>Check for secrets</AlertTitle>
            <AlertDescription>
              Includes instructions, tool output and attachments. Earlier versions stay available.
            </AlertDescription>
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
        {!result && (
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              {error ? "Done" : "Cancel"}
            </Button>
            {!error && (
              <Button disabled={!allowed || busy} onClick={submit}>
                {busy && <Spinner data-icon="inline-start" />}
                {busy ? "Sharing…" : "Share"}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
