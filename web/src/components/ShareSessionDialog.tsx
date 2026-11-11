import { CheckIcon, CopyIcon, ExternalLinkIcon, InfoIcon } from "lucide-react";
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
  machine,
  submit,
  close,
}: {
  open: boolean;
  phase: SharePhase;
  allowed: boolean;
  signedIn: boolean;
  /** The remote machine that publishes, with its own Radius sign-in; absent on Local. */
  machine?: string;
  submit: () => void;
  close: () => void;
}) {
  const result = phase.phase === "shared" ? phase.share : undefined;
  const error = phase.phase === "failed" ? phase.error : undefined;
  const busy = phase.phase === "publishing";
  return (
    <Dialog open={open} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!busy}
        aria-describedby={result ? undefined : "share-session-description"}
      >
        <DialogHeader>
          <DialogTitle>{result ? "Session shared" : "Share session"}</DialogTitle>
          {!result && (
            <DialogDescription id="share-session-description">
              Share a snapshot with {machine ? `${machine}'s` : "your"} Radius organization. Reuses
              the same link when available.
            </DialogDescription>
          )}
        </DialogHeader>
        {result ? (
          <ShareLink url={result.url} expiresAt={result.expiresAt} />
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
                Share
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The shared link with its copy and open buttons. Mounted only while the dialog shows a share, so
 * each share starts uncopied; the copy confirmation is its own and never reaches the form.
 */
function ShareLink({ url, expiresAt }: { url: string; expiresAt: string }) {
  const { copied, copy } = useCopy(url, "Could not copy the link. Select and copy it below.");
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="session-share-link">Share link</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="session-share-link"
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton size="icon-sm" aria-label="Copy link" onClick={() => void copy()}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{copied ? "Copied" : "Copy link"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton size="icon-sm" asChild>
                  <a
                    href={url}
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
        <FieldDescription>Expires {new Date(expiresAt).toLocaleDateString()}.</FieldDescription>
      </Field>
    </FieldGroup>
  );
}
