import type { RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";
import { CheckCircle2Icon, ExternalLinkIcon, GlobeIcon, PanelLeftOpenIcon, RefreshCwIcon, UserRoundIcon, WrenchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
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
        {configured ? "All set. New Pi sessions can use Radius tools and web search." : "Sign in once, then choose what Pi can use from Radius."}{" "}
        <a className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline" href="https://radius.earendil.com/docs/extensions" target="_blank" rel="noopener noreferrer">
          Setup guide<ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      </p>
    </header>
    {(error || actionError) && <Alert variant="destructive"><AlertTitle>Radius setup needs attention</AlertTitle><AlertDescription>{error || actionError}</AlertDescription></Alert>}
    {!state ? <div role="status" className="flex flex-col gap-3"><span className="sr-only">Loading Radius setup…</span><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-44 w-full rounded-xl" /></div>
      : <>
        <Item variant="outline" className="rounded-xl px-4 sm:px-5">
          <ItemMedia variant="icon"><UserRoundIcon /></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>Radius account<ReadyMark ready={signedIn} label="Signed in" /></ItemTitle>
            <ItemDescription className="line-clamp-none">
              {!radius ? "Radius sign-in is unavailable in this Pi installation." : signedIn ? "Signed in. Pi keeps the sign-in fresh for you." : "Sign in to set up Radius tools and web search."}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="max-sm:basis-full max-sm:pl-12">
            {signedIn
              ? <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} aria-label="Sign out of Radius" onClick={() => setConfirmSignOut(true)}>
                {signingOut && <Spinner data-icon="inline-start" />}{signingOut ? "Signing out…" : "Sign out"}
              </Button>
              : <Button size="sm" disabled={disabled || !radius} onClick={() => setLogin(crypto.randomUUID())}>Sign in to Radius</Button>}
          </ItemActions>
        </Item>
        <section aria-labelledby="radius-features" className="flex flex-col gap-3">
          <h2 id="radius-features" className="text-sm font-medium">Use in Pi</h2>
          <ItemGroup className="rounded-xl border">
            <Item className="rounded-none px-4 sm:px-5">
              <ItemMedia variant="icon"><WrenchIcon /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>Radius MCP<ReadyMark ready={mcpReady} label="Set up" /></ItemTitle>
                <ItemDescription className="line-clamp-none">Give Pi your Radius tools, using the same sign-in.</ItemDescription>
                {state.mcp.detail && <p className="text-xs text-muted-foreground">{state.mcp.detail}</p>}
              </ItemContent>
              <ItemActions className="max-sm:basis-full max-sm:pl-12">
                {!mcpReady && <Button variant="outline" size="sm" disabled={disabled || state.mcp.status === "blocked" || !signedIn} onClick={() => void act("configure-mcp")}>Set up MCP</Button>}
                {state.mcp.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} onClick={() => setRemoval({ action: "remove-mcp", key: state.mcp.removalKey! })}>Remove MCP</Button>}
              </ItemActions>
            </Item>
            <ItemSeparator />
            <Item className="rounded-none px-4 sm:px-5">
              <ItemMedia variant="icon"><GlobeIcon /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>Web search<ReadyMark ready={webSearchReady} label="Installed" /></ItemTitle>
                <ItemDescription className="line-clamp-none">Let Pi search the web with the Radius extension.</ItemDescription>
                {state.webSearch.detail && <p className="text-xs text-muted-foreground">{state.webSearch.detail}</p>}
                <p className="text-xs text-muted-foreground">An organization owner or admin must enable Web search separately in Radius.</p>
              </ItemContent>
              <ItemActions className="max-sm:basis-full max-sm:pl-12">
                {installing ? <Button variant="outline" size="sm" disabled><Spinner data-icon="inline-start" />{state.installation.action === "uninstall" ? "Uninstalling…" : "Installing…"}</Button>
                  : <>
                    {!webSearchReady && <Button variant="outline" size="sm" disabled={disabled || state.webSearch.status === "blocked" || !signedIn} onClick={() => void act("install-web-search")}>Install web search</Button>}
                    {state.webSearch.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} onClick={() => setRemoval({ action: "uninstall-web-search", key: state.webSearch.removalKey! })}>Uninstall extension</Button>}
                  </>}
              </ItemActions>
            </Item>
          </ItemGroup>
        </section>
      </>}
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

/** A quiet check beside a title once that part is ready; screen readers hear the label. */
function ReadyMark({ ready, label }: { ready: boolean; label: string }) {
  if (!ready) return null;
  return <><CheckCircle2Icon className="size-3.5 text-brand" aria-hidden /><span className="sr-only">({label})</span></>;
}
