import type { RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";
import { cn } from "cn";
import { CheckIcon, ExternalLinkIcon, PanelLeftOpenIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

type SetupAction = "configure-mcp" | "install-web-search" | "remove-mcp" | "uninstall-web-search";
type Removal = { action: "remove-mcp" | "uninstall-web-search"; key: string };

async function setupRequest(action?: SetupAction, signal?: AbortSignal, removalKey?: string): Promise<RadiusSetupState> {
  const response = await fetch("/api/settings/radius", { signal, ...(action ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, removalKey }),
  } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load Radius setup.");
  return result.state;
}

export function RadiusSettings({ onMenu, providersChanged }: { onMenu: () => void; providersChanged: () => void }) {
  const [state, setState] = useState<RadiusSetupState>();
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [login, setLogin] = useState<string>();
  const [removal, setRemoval] = useState<Removal>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let installing = false;
    const load = async () => {
      setRefreshing(true);
      try {
        const [next, response] = await Promise.all([setupRequest(undefined, controller.signal), fetch("/api/oauth-providers", { signal: controller.signal })]);
        if (!response.ok) throw new Error("Could not load Radius sign-in status.");
        const result = await response.json();
        if (controller.signal.aborted) return;
        setProviders(result.providers); setState(next); setError("");
        installing = next.installation.status === "running";
      } catch { if (!controller.signal.aborted) setError("Could not refresh Radius setup. Check your connection and try again."); }
      finally { if (!controller.signal.aborted) setRefreshing(false); }
      if (!controller.signal.aborted && installing) timer = setTimeout(load, 1500);
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);
  const refreshProviders = useCallback(() => { setRevision(value => value + 1); providersChanged(); }, [providersChanged]);
  const signOut = async () => {
    setSigningOut(true); setActionError("");
    try {
      const response = await fetch("/api/provider-logout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "radius" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not sign out. Try again.");
      // Only acknowledge sign-out after Pi confirms credential removal.
      setProviders(current => current.map(provider => provider.id === "radius" ? { ...provider, signedIn: false } : provider));
      refreshProviders();
      toast.success("Signed out of Radius.");
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not sign out. Try again."); }
    finally { setSigningOut(false); setConfirmSignOut(false); }
  };
  const act = async (action: SetupAction, removalKey?: string) => {
    setBusy(true); setActionError("");
    try {
      setState(await setupRequest(action, undefined, removalKey));
      if (action === "configure-mcp") toast.success("Radius MCP configured. Start a new session to use it.");
      if (action === "remove-mcp") toast.success("Radius MCP removed for new sessions.");
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not complete setup. Refresh before retrying."); }
    finally { setBusy(false); setRemoval(undefined); setRevision(value => value + 1); }
  };
  const radius = providers.find(provider => provider.id === "radius");
  const installing = state?.installation.status === "running";
  const disabled = busy || signingOut || refreshing || installing || !!error;
  const configured = radius?.signedIn && state?.mcp.status === "ready" && state.webSearch.status === "ready"
    && !disabled && !refreshing && !actionError && state.installation.status !== "error";
  const signedIn = !!radius?.signedIn;
  const mcpReady = state?.mcp.status === "ready";
  const webSearchReady = state?.webSearch.status === "ready";
  const current = !signedIn ? 1 : !mcpReady ? 2 : !webSearchReady ? 3 : 0;
  return <>
    <header className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
        <h1 id="settings-section-title" className="text-xl font-semibold">Radius</h1>
        <IconButton className="ml-auto" label="Refresh setup" disabled={busy || signingOut || refreshing} onClick={() => { setActionError(""); setRevision(value => value + 1); }}>
          {refreshing ? <Spinner /> : <RefreshCwIcon />}
        </IconButton>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        {configured ? "All set. New Pi sessions can use Radius tools and web search." : "Connect Pi to your Radius account, tools and web search in three steps."}{" "}
        <a className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline" href="https://radius.earendil.com/docs/extensions" target="_blank" rel="noopener noreferrer">
          Setup guide<ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      </p>
    </header>
    {(error || actionError) && <Alert variant="destructive"><AlertTitle>Radius setup needs attention</AlertTitle><AlertDescription>{error || actionError}</AlertDescription></Alert>}
    {!state ? <div role="status" className="flex flex-col gap-3"><span className="sr-only">Loading Radius setup…</span><Skeleton className="h-72 w-full rounded-xl" /></div>
      : <ol aria-label="Radius setup steps" className="rounded-xl border px-4 sm:px-6">
        <SetupStep number={1} done={signedIn} current={current === 1} title="Sign in"
          description="Connect your Radius account. Pi keeps the sign-in fresh for you."
          notes={!radius ? ["Radius sign-in is unavailable in this Pi installation."] : []}>
          {signedIn
            ? <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} aria-label="Sign out of Radius" onClick={() => setConfirmSignOut(true)}>
              {signingOut && <Spinner data-icon="inline-start" />}{signingOut ? "Signing out…" : "Sign out"}
            </Button>
            : <Button variant={current === 1 ? "default" : "outline"} size="sm" disabled={disabled || !radius} onClick={() => setLogin(crypto.randomUUID())}>Sign in to Radius</Button>}
        </SetupStep>
        <SetupStep number={2} done={mcpReady} current={current === 2} title="Set up Radius MCP"
          description="Give Pi your Radius tools, using the same sign-in."
          notes={[!signedIn && !mcpReady ? "Available after you sign in." : "", state.mcp.detail ?? ""]}>
          {!mcpReady && <Button variant={current === 2 ? "default" : "outline"} size="sm" disabled={disabled || state.mcp.status === "blocked" || !signedIn} onClick={() => void act("configure-mcp")}>Set up MCP</Button>}
          {state.mcp.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} onClick={() => setRemoval({ action: "remove-mcp", key: state.mcp.removalKey! })}>Remove MCP</Button>}
        </SetupStep>
        <SetupStep number={3} done={webSearchReady} current={current === 3} title="Install web search"
          description="Install the Radius web-search extension so Pi can search the web."
          notes={[!signedIn && !webSearchReady ? "Available after you sign in." : "", state.webSearch.detail ?? "", "An organization owner or admin must enable Web search separately in Radius."]}>
          {installing ? <Button variant="outline" size="sm" disabled><Spinner data-icon="inline-start" />{state.installation.action === "uninstall" ? "Uninstalling…" : "Installing…"}</Button>
            : <>
              {!webSearchReady && <Button variant={current === 3 ? "default" : "outline"} size="sm" disabled={disabled || state.webSearch.status === "blocked" || !signedIn} onClick={() => void act("install-web-search")}>Install web search</Button>}
              {state.webSearch.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} onClick={() => setRemoval({ action: "uninstall-web-search", key: state.webSearch.removalKey! })}>Uninstall extension</Button>}
            </>}
        </SetupStep>
      </ol>}
    {state?.installation.status === "error" && <Alert variant="destructive"><AlertTitle>{state.installation.action === "uninstall" ? "Extension was not uninstalled" : "Web search was not installed"}</AlertTitle><AlertDescription>{state.installation.detail}</AlertDescription></Alert>}
    <Dialog open={!!removal} onOpenChange={open => { if (!open && !busy) setRemoval(undefined); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{removal?.action === "remove-mcp" ? "Remove Radius MCP?" : "Uninstall web-search extension?"}</DialogTitle>
          <DialogDescription>
            {removal?.action === "remove-mcp"
              ? "Removes Radius MCP from Pi on this machine."
              : "Removes the web-search extension from Pi on this machine."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setRemoval(undefined)}>Cancel</Button>
          <Button variant="destructive" disabled={disabled} onClick={() => { if (removal) void act(removal.action, removal.key); }}>
            {busy && <Spinner data-icon="inline-start" />}{removal?.action === "remove-mcp" ? "Remove MCP" : "Uninstall extension"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmSignOut && <ProviderSignOutDialog name="Radius" busy={signingOut} cancel={() => setConfirmSignOut(false)} confirm={() => void signOut()} />}
    {login && <ProviderLoginDialog key={login} initialProvider="radius" providers={providers} close={() => { setLogin(undefined); setRevision(value => value + 1); }} signedIn={refreshProviders} />}
  </>;
}

/**
 * One step of the setup checklist. Hand-written: shadcn/ui has no stepper, and a numbered rail
 * shows the order and progress that separate cards hid.
 */
function SetupStep({ number, done, current, title, description, notes, children }: {
  number: number; done: boolean; current: boolean; title: string; description: string; notes: string[]; children: ReactNode;
}) {
  return <li className="group/step relative flex gap-4 py-5" aria-current={current ? "step" : undefined}>
    <span aria-hidden className="absolute top-[3.375rem] -bottom-[1.125rem] left-3.5 w-px -translate-x-1/2 bg-border group-last/step:hidden" />
    <span aria-hidden className={cn("relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums transition-colors",
      done ? "border-transparent bg-brand text-brand-ink" : current ? "border-brand bg-brand-soft text-brand" : "bg-background text-muted-foreground")}>
      {done ? <CheckIcon className="size-4" strokeWidth={2.5} /> : number}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className={cn("text-sm font-medium leading-7", !done && !current && "text-muted-foreground")}>
          {title}<span className="sr-only">{done ? " (done)" : current ? " (next step)" : ""}</span>
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {notes.filter(Boolean).map(note => <p key={note} className="text-xs text-muted-foreground/80">{note}</p>)}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 empty:hidden">{children}</div>
    </div>
  </li>;
}
