import type { OAuthProvider, ProviderLoginState } from "@shared/wire";
import { CheckCircleIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/PianoSelect";
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
import { providerLogin } from "@/lib/api";
import type { SignInApi } from "@/lib/signInAttempt";
import { useSignInAttempt } from "@/lib/useSignInAttempt";

function safeUrl(raw?: string) {
  try {
    const url = new URL(raw!);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Explicit dismissal cancels pending sign-in; browser disconnect still preserves it.
 * `api` runs another sign-in of the same shape, such as an MCP server's. */
export function ProviderLoginDialog({
  initialProvider,
  providers,
  close,
  signedIn,
  api = providerLogin,
}: {
  initialProvider: string;
  providers: readonly OAuthProvider[];
  close: () => void;
  signedIn: () => void;
  api?: SignInApi;
}) {
  const {
    attempt: state,
    busy,
    error,
    connectionError,
    answer,
    retry,
    dismiss,
  } = useSignInAttempt({ api, provider: initialProvider, signedIn, close });
  const running = state?.status === "running";
  const prompt = running ? state.prompt : undefined;
  const url = running ? safeUrl(state.url) : undefined;
  const providerId = state?.provider ?? initialProvider;
  const providerName = providers.find((provider) => provider.id === providerId)?.name ?? providerId;
  const dismissLabel = state?.status === "success" ? "Done" : running || busy ? "Cancel" : "Close";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto"
        showCloseButton={!busy}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Sign in to {providerName}</DialogTitle>
          <DialogDescription>
            {prompt?.type === "select"
              ? "Choose a sign-in method."
              : running && url && !prompt
                ? "Waiting for authorization…"
                : "Follow the steps to connect your account."}
          </DialogDescription>
        </DialogHeader>
        {state?.status === "success" ? (
          <Alert role="status">
            <CheckCircleIcon />
            <AlertTitle>You’re signed in.</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : (
          state?.message && (
            <p role="status" className="text-sm text-muted-foreground">
              {state.message}
            </p>
          )
        )}
        {prompt && url && (
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              Open sign-in page
            </a>
          </Button>
        )}
        {state?.userCode && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="login-device-code">Device code</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="login-device-code"
                  className="font-mono"
                  value={state.userCode}
                  readOnly
                  spellCheck={false}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-sm"
                    aria-label="Copy device code"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(state.userCode!);
                        toast.success("Device code copied.");
                      } catch {
                        toast.error("Could not copy. Select the code and copy it manually.");
                      }
                    }}
                  >
                    <CopyIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        )}
        {prompt && (
          <LoginPromptForm
            key={prompt.id}
            state={state!}
            busy={busy}
            cancel={dismiss}
            answer={(value) => answer(prompt.id, value)}
          />
        )}
        {busy && !prompt && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {(error || connectionError) && (
          <Alert variant="destructive">
            <AlertDescription>{error || connectionError}</AlertDescription>
          </Alert>
        )}
        {!prompt && (
          <DialogFooter>
            <Button
              variant={state?.status === "success" ? "default" : "outline"}
              disabled={busy}
              onClick={dismiss}
            >
              {dismissLabel}
            </Button>
            {(state?.status === "error" || state?.status === "cancelled") && (
              <Button disabled={busy} onClick={retry}>
                Try again
              </Button>
            )}
            {url && (
              <Button asChild>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  Open sign-in page
                </a>
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
function LoginPromptForm({
  state,
  busy,
  answer,
  cancel,
}: {
  state: ProviderLoginState;
  busy: boolean;
  answer: (value: string) => void;
  cancel: () => void;
}) {
  const prompt = state.prompt!;
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) {
          answer(value);
          setValue("");
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="login-answer">{prompt.message}</FieldLabel>
          {prompt.type === "select" ? (
            <Select value={value} onValueChange={setValue} disabled={busy}>
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
        {prompt.type === "select" && prompt.options && prompt.options.length > 1 && (
          <p className="text-sm text-muted-foreground">
            If Piano runs on another machine, choose a device-code or copy-code method when offered.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (prompt.type === "select" && !value)}>
            Continue
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
