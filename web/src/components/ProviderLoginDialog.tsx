import type { OAuthProvider, ProviderLoginState } from "@shared/wire";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

async function request(method = "GET", body?: unknown): Promise<{ state: ProviderLoginState | null }> {
  const response = await fetch("/api/provider-login", { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not complete sign-in.");
  return result;
}
function safeUrl(raw?: string) {
  try { const url = new URL(raw!); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}

/** Global operation: closing the window does not cancel server-owned sign-in. */
export function ProviderLoginDialog({ initialProvider, close, signedIn }: { initialProvider: string; close: () => void; signedIn: () => void }) {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [provider, setProvider] = useState(initialProvider);
  const [state, setState] = useState<ProviderLoginState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  // StrictMode must not submit login twice. Re-attach to the same initialization.
  const initialization = useRef<Promise<{ providers: OAuthProvider[]; state: ProviderLoginState | null }> | null>(null);
  useEffect(() => {
    let alive = true;
    initialization.current ??= (async () => {
      const response = await fetch("/api/oauth-providers");
      if (!response.ok) throw new Error("Could not load OAuth providers.");
      const { providers } = await response.json();
      let { state } = await request();
      if (initialProvider && state?.status !== "running") ({ state } = await request("POST", { provider: initialProvider }));
      return { providers, state: state?.status === "running" || initialProvider ? state : null };
    })();
    void initialization.current.then(result => { if (alive) { setProviders(result.providers); setState(result.state); } }).catch(error => { if (alive) setError(error.message); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [initialProvider]);
  useEffect(() => {
    if (state?.status !== "running" || busy) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = epoch.current;
      try {
        const result = await request();
        if (alive && version === epoch.current) { setState(result.state); setError(""); }
      } catch { if (alive && version === epoch.current) setError("Connection lost. Sign-in will resume when Piano reconnects."); }
      if (alive) timer = setTimeout(poll, 750);
    };
    timer = setTimeout(poll, 750);
    return () => { alive = false; clearTimeout(timer); };
  }, [state?.status, busy]);
  const change = async (method: string, body: unknown) => {
    epoch.current++;
    setBusy(true); setError("");
    try { setState((await request(method, body)).state); } catch (error) { setError(error instanceof Error ? error.message : "Could not complete sign-in."); }
    finally { epoch.current++; setBusy(false); }
  };
  const notified = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state?.status === "success" && notified.current !== state.id) { notified.current = state.id; signedIn(); }
  }, [state?.status, state?.id, signedIn]);
  const prompt = state?.prompt;
  const url = safeUrl(state?.url);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Sign in{state ? ` · ${state.provider}` : ""}</DialogTitle>
        <DialogDescription>Connect an OAuth provider through Pi.</DialogDescription>
      </DialogHeader>
      {!state && !busy && <FieldGroup><Field><FieldLabel>Provider</FieldLabel>
        <Select value={provider} onValueChange={setProvider}><SelectTrigger aria-label="Provider"><SelectValue placeholder="Choose a provider" /></SelectTrigger>
          <SelectContent><SelectGroup>{providers.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field><Button disabled={!provider || busy} onClick={() => void change("POST", { provider })}>Sign in</Button></FieldGroup>}
      {state?.message && <p role="status" className="text-sm text-muted-foreground">{state.message}</p>}
      {state?.status === "running" && url && <Button asChild variant="outline"><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open sign-in page</a></Button>}
      {state?.userCode && <FieldGroup><Field><FieldLabel htmlFor="login-device-code">Device code</FieldLabel><Input id="login-device-code" value={state.userCode} readOnly /></Field></FieldGroup>}
      {prompt && <LoginPromptForm key={prompt.id} state={state!} busy={busy} answer={value => void change("PUT", { id: state!.id, promptId: prompt.id, value })} />}
      {busy && !prompt && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        {state?.status === "running" && <Button variant="outline" disabled={busy} onClick={() => void change("DELETE", { id: state.id })}>Cancel sign-in</Button>}
        {(state?.status === "error" || state?.status === "cancelled") && <Button disabled={busy} onClick={() => void change("POST", { provider: state.provider })}>Try again</Button>}
        <Button variant="ghost" onClick={close}>{state?.status === "running" ? "Hide" : "Close"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
function LoginPromptForm({ state, busy, answer }: { state: ProviderLoginState; busy: boolean; answer: (value: string) => void }) {
  const prompt = state.prompt!;
  const [value, setValue] = useState("");
  return <form onSubmit={event => { event.preventDefault(); if (!busy) { answer(value); setValue(""); } }}>
    <FieldGroup><Field><FieldLabel htmlFor="login-answer">{prompt.message}</FieldLabel>
      {prompt.type === "select" ? <Select value={value} onValueChange={setValue} disabled={busy}>
        <SelectTrigger id="login-answer"><SelectValue placeholder="Choose a sign-in method" /></SelectTrigger>
        <SelectContent><SelectGroup>{prompt.options?.map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select> : <Input id="login-answer" type={prompt.type === "text" ? "text" : "password"} value={value} onChange={event => setValue(event.target.value)} placeholder={prompt.placeholder} autoComplete="off" spellCheck={false} disabled={busy} />}
      </Field><Button type="submit" disabled={busy || (prompt.type === "select" && !value)}>Continue</Button>
      {prompt.type === "select" && <p className="text-sm text-muted-foreground">If Piano runs on another machine, choose a device-code or copy-code method when offered.</p>}
    </FieldGroup>
  </form>;
}
