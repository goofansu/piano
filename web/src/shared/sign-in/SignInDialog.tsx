import type { LoginPrompt, OAuthProvider } from "@shared/wire";
import { CheckCircleIcon, CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useCopy } from "@/shared/components/CopyButton";
import { PianoLinkButton } from "@/shared/components/PianoButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/PianoDialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/PianoSelect";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/PianoTooltip";
import { useLastShown } from "@/shared/lib/useLastShown";
import { canSubmitAnswer, type SignInApi, signInDialogView } from "@/shared/sign-in/signInAttempt";
import { useSignInAttempt } from "@/shared/sign-in/useSignInAttempt";

function SignInLink({ url, variant }: { url: string; variant?: "outline" }) {
  return (
    <PianoLinkButton
      variant={variant}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
    >
      Open sign-in page
      <ExternalLinkIcon data-icon="inline-end" aria-hidden />
    </PianoLinkButton>
  );
}

interface OpenSignIn {
  key: string;
  provider: string;
}

export function SignInDialog({
  signIn,
  providers,
  close,
  signedIn,
  api,
}: {
  signIn: OpenSignIn | undefined;
  providers: readonly OAuthProvider[];
  close: () => void;
  signedIn: () => void;
  api: SignInApi;
}) {
  const shown = useLastShown(signIn);
  return shown ? (
    <SignInForm
      key={shown.key}
      open={!!signIn}
      provider={shown.provider}
      providers={providers}
      close={close}
      signedIn={signedIn}
      api={api}
    />
  ) : null;
}

function SignInForm({
  open,
  provider,
  providers,
  close,
  signedIn,
  api,
}: {
  open: boolean;
  provider: string;
  providers: readonly OAuthProvider[];
  close: () => void;
  signedIn: () => void;
  api: SignInApi;
}) {
  const { attempt, busy, error, connectionError, answer, retry, dismiss } = useSignInAttempt({
    api,
    provider,
    open,
    signedIn,
    close,
  });
  const view = signInDialogView({
    state: { attempt, busy, error, connectionError },
    provider,
    providers,
  });
  const { prompt, url, deviceCode, footer } = view;
  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next && open) dismiss();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{view.title}</DialogTitle>
          {view.description && <DialogDescription>{view.description}</DialogDescription>}
        </DialogHeader>
        {view.success ? (
          <Alert role="status">
            <CheckCircleIcon />
            <AlertTitle>You’re signed in.</AlertTitle>
            <AlertDescription>{view.message}</AlertDescription>
          </Alert>
        ) : (
          view.message && (
            <p role="status" className="text-sm text-muted-foreground">
              {view.message}
            </p>
          )
        )}
        {view.link === "body" && url && <SignInLink url={url} variant="outline" />}
        {deviceCode && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="login-device-code">Device code</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="login-device-code"
                  className="font-mono"
                  value={deviceCode}
                  readOnly
                  spellCheck={false}
                />
                <InputGroupAddon align="inline-end">
                  <CopyDeviceCode code={deviceCode} />
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        )}
        {prompt && (
          <LoginPromptForm
            key={prompt.id}
            prompt={prompt}
            label={view.label ?? prompt.message}
            busy={busy}
            cancel={dismiss}
            answer={(value) => answer(prompt.id, value)}
          />
        )}
        {view.loading && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {view.alert && (
          <Alert variant="destructive">
            <AlertDescription>{view.alert}</AlertDescription>
          </Alert>
        )}
        {footer && (
          <DialogFooter>
            <Button
              variant={footer.dismissPrimary ? "default" : "outline"}
              disabled={busy}
              onClick={dismiss}
            >
              {footer.dismissLabel}
            </Button>
            {footer.retry && (
              <Button disabled={busy} onClick={retry}>
                Try again
              </Button>
            )}
            {view.link === "footer" && url && <SignInLink url={url} />}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
function CopyDeviceCode({ code }: { code: string }) {
  const { copied, copy } = useCopy(code, "Could not copy. Select the code to copy it.");
  const label = copied ? "Device code copied" : "Copy device code";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton size="icon-sm" aria-label={label} onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </InputGroupButton>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function LoginPromptForm({
  prompt,
  label,
  busy,
  answer,
  cancel,
}: {
  prompt: LoginPrompt;
  label: string;
  busy: boolean;
  answer: (value: string) => void;
  cancel: () => void;
}) {
  const [value, setValue] = useState("");
  const canSubmit = canSubmitAnswer({ prompt, busy, value });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          answer(value);
          setValue("");
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="login-answer">{label}</FieldLabel>
          {prompt.type === "select" ? (
            <Select
              items={prompt.options?.map((option) => ({ value: option.id, label: option.label }))}
              value={value || null}
              onValueChange={(next) => setValue(next ?? "")}
              disabled={busy}
            >
              <SelectTrigger id="login-answer">
                <SelectValue placeholder="Choose a sign-in method" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {prompt.options?.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="login-answer"
              type={prompt.type === "text" ? "text" : "password"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={prompt.placeholder}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          )}
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            Continue
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
