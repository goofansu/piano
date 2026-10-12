import type { OAuthProvider, ProviderLoginState } from "@shared/wire";
import { CheckCircleIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ProviderLoginRequest, providerLogin } from "@/lib/api";

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
  providers: OAuthProvider[];
  close: () => void;
  signedIn: () => void;
  api?: (request?: ProviderLoginRequest) => Promise<ProviderLoginState | null>;
}) {
  const [state, setState] = useState<ProviderLoginState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const epoch = useRef(0);
  // StrictMode must not submit login twice. Re-attach to the same initialization.
  const initialization = useRef<Promise<ProviderLoginState | null> | null>(null);
  useEffect(() => {
    let alive = true;
    initialization.current ??= (async () => {
      const state = await api();
      return initialProvider && state?.status !== "running"
        ? api({ method: "POST", body: { provider: initialProvider } })
        : state;
    })();
    void initialization.current
      .then((state) => {
        if (alive) {
          setState(state);
        }
      })
      .catch((error) => {
        if (alive) setError(error.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [initialProvider, api]);
  useEffect(() => {
    if (state?.status !== "running" || busy) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = epoch.current;
      try {
        const next = await api();
        if (alive && version === epoch.current) {
          setState(next);
          setConnectionError("");
          if (next?.status !== "running") setError("");
        }
      } catch {
        if (alive && version === epoch.current)
          setConnectionError("Connection lost. Sign-in will resume when Piano reconnects.");
      }
      if (alive) timer = setTimeout(poll, 750);
    };
    timer = setTimeout(poll, 750);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [state?.status, busy, api]);
  const change = async (request: ProviderLoginRequest) => {
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      setState(await api(request));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not complete sign-in.");
    } finally {
      epoch.current++;
      setBusy(false);
    }
  };
  const notified = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state?.status === "success" && notified.current !== state.id) {
      notified.current = state.id;
      signedIn();
    }
  }, [state?.status, state?.id, signedIn]);
  const dismissing = useRef(false);
  const dismiss = async () => {
    // Do not abandon an initialization/answer whose resulting attempt is not known yet.
    if (busy || dismissing.current) return;
    dismissing.current = true;
    if (state?.status !== "running") {
      close();
      return;
    }
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      const result = await api({ method: "DELETE", body: { id: state.id } });
      // Authorization may have completed before cancellation reached the server.
      if (result?.status === "success") signedIn();
      close();
    } catch {
      setError("Could not cancel sign-in. Check your connection and try again.");
    } finally {
      epoch.current++;
      dismissing.current = false;
      setBusy(false);
    }
  };
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
        if (!open) void dismiss();
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
            cancel={() => void dismiss()}
            answer={(value) =>
              void change({ method: "PUT", body: { id: state!.id, promptId: prompt.id, value } })
            }
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
              onClick={() => void dismiss()}
            >
              {dismissLabel}
            </Button>
            {(state?.status === "error" || state?.status === "cancelled") && (
              <Button
                disabled={busy}
                onClick={() => void change({ method: "POST", body: { provider: state.provider } })}
              >
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
