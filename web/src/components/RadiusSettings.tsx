import type { RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";
import { cn } from "cn";
import { CheckCircle2Icon, ExternalLinkIcon, GlobeIcon, RefreshCwIcon, UserRoundIcon, WrenchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { SettingsHeader } from "@/components/SettingsHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

type SetupAction = "configure-mcp" | "install-web-search" | "remove-mcp" | "uninstall-web-search";
type Removal = { action: "remove-mcp" | "uninstall-web-search"; key: string };

/** One turn of the refresh icon, so a fast refresh still reads as a refresh instead of a flicker. */
const REFRESH_SPIN_MS = 600;
/** Setup toasts share an id, so finishing setup replaces the step's toast instead of stacking. */
const SETUP_TOAST = "radius-setup";

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
  const manualRefresh = useRef(false);
  // Web search changes finish in the background; remember one seen to finish here until it can be announced.
  const lastInstallation = useRef<RadiusSetupState["installation"]["status"]>(undefined);
  const finished = useRef<"install" | "uninstall">(undefined);
  const observe = useCallback((next: RadiusSetupState) => {
    if (lastInstallation.current === "running" && next.installation.status === "success") finished.current = next.installation.action;
    lastInstallation.current = next.installation.status;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let installing = false;
    const load = async () => {
      setRefreshing(true);
      const manual = manualRefresh.current;
      manualRefresh.current = false;
      try {
        const [next, response] = await Promise.all([
          setupRequest(undefined, controller.signal), fetch("/api/oauth-providers", { signal: controller.signal }),
          manual && new Promise(resolve => setTimeout(resolve, REFRESH_SPIN_MS)),
        ]);
        if (!response.ok) throw new Error("Could not load Radius sign-in status.");
        const result = await response.json();
        if (controller.signal.aborted) return;
        observe(next); setProviders(result.providers); setState(next); setError("");
        installing = next.installation.status === "running";
        // A running or just-finished web-search change gets its own toast once it settles.
        if (manual && !installing && !finished.current) toast.success("Radius setup is up to date.", { id: SETUP_TOAST });
      } catch { if (!controller.signal.aborted) setError("Could not refresh Radius setup. Check your connection and try again."); }
      finally { if (!controller.signal.aborted) setRefreshing(false); }
      if (!controller.signal.aborted && installing) timer = setTimeout(load, 1500);
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision, observe]);
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
      const next = await setupRequest(action, undefined, removalKey);
      observe(next); setState(next);
      if (action === "configure-mcp") toast.success("Radius MCP added. Start a new session to use it.", { id: SETUP_TOAST });
      if (action === "remove-mcp") toast.success("Radius MCP removed for new sessions.", { id: SETUP_TOAST });
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not complete setup. Refresh before retrying."); }
    finally { setBusy(false); setRemoval(undefined); setRevision(value => value + 1); }
  };
  const radius = providers.find(provider => provider.id === "radius");
  const installing = state?.installation.status === "running";
  const disabled = busy || signingOut || refreshing || installing || !!error;
  const configured = !!radius?.signedIn && state?.mcp.status === "ready" && state.webSearch.status === "ready"
    && state.installation.status !== "error";
  const settled = !!state && !busy && !signingOut && !refreshing && !installing && !error && !actionError;
  // Announce completion only when setup turns complete here, not each time a complete setup is opened.
  const wasConfigured = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!settled) return;
    const change = finished.current;
    finished.current = undefined;
    // One toast per change: completing setup outranks the install that completed it.
    if (wasConfigured.current === false && configured) toast.success("All set. New Pi sessions can use Radius tools and web search.", { id: SETUP_TOAST });
    else if (change === "install") toast.success("Web search installed. Start a new session to use it.", { id: SETUP_TOAST });
    else if (change === "uninstall") toast.success("Web search uninstalled for new sessions.", { id: SETUP_TOAST });
    wasConfigured.current = configured;
  }, [settled, configured]);
  const signedIn = !!radius?.signedIn;
  const mcpReady = state?.mcp.status === "ready";
  const webSearchReady = state?.webSearch.status === "ready";
  return <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
    <SettingsHeader title="Radius" titleId="settings-section-title" onMenu={onMenu}>
      <IconButton label="Refresh setup" disabled={busy || signingOut || refreshing} onClick={() => { setActionError(""); manualRefresh.current = true; setRevision(value => value + 1); }}>
          <RefreshCwIcon className={cn(refreshing && "animate-spin [animation-duration:600ms] motion-reduce:animate-none")} />
      </IconButton>
    </SettingsHeader>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 lg:p-10">
     <section aria-labelledby="settings-section-title" className="mx-auto flex max-w-2xl flex-col gap-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        Sign in once, then choose what Pi can use from Radius.{" "}
        <a className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline" href="https://radius.earendil.com/docs/extensions" target="_blank" rel="noopener noreferrer">
          Setup guide<ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      </p>
    {(error || actionError) && <Alert variant="destructive"><AlertTitle>Radius setup needs attention</AlertTitle><AlertDescription>{error || actionError}</AlertDescription></Alert>}
    {!state ? <div role="status" className="flex flex-col gap-3"><span className="sr-only">Loading Radius setup…</span><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-44 w-full rounded-xl" /></div>
      : <>
        <Item variant="outline" className="rounded-xl px-4 sm:px-5">
          <ItemMedia variant="icon"><UserRoundIcon /></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>Radius account<ReadyMark ready={signedIn} label="Signed in" /></ItemTitle>
            <ItemDescription className="line-clamp-none">
              {!radius ? "Radius sign-in is unavailable in this Pi installation." : signedIn ? "Signed in. You stay signed in until you sign out." : "Sign in to set up Radius tools and web search."}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="max-sm:basis-full max-sm:pl-12">
            {signedIn
              ? <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} aria-label="Sign out of Radius" onClick={() => setConfirmSignOut(true)}>
                {signingOut && <Spinner data-icon="inline-start" />}{signingOut ? "Signing out…" : "Sign out"}
              </Button>
              : <Button size="sm" disabled={disabled || !radius} aria-label="Sign in to Radius" onClick={() => setLogin(crypto.randomUUID())}>Sign in</Button>}
          </ItemActions>
        </Item>
        <section aria-labelledby="radius-features" className="flex flex-col gap-3">
          <h2 id="radius-features" className="text-sm font-medium">Use in Pi</h2>
          <ItemGroup className="rounded-xl border">
            <Item className="rounded-none px-4 sm:px-5">
              <ItemMedia variant="icon"><WrenchIcon /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>Radius MCP<ReadyMark ready={mcpReady} label="Added" /></ItemTitle>
                <ItemDescription className="line-clamp-none">Give Pi your Radius tools, using the same sign-in.</ItemDescription>
                {state.mcp.detail && <p className="text-xs text-muted-foreground">{state.mcp.detail}</p>}
              </ItemContent>
              <ItemActions className="max-sm:basis-full max-sm:pl-12">
                {!mcpReady && <Button variant="outline" size="sm" disabled={disabled || state.mcp.status === "blocked" || !signedIn} aria-label="Add Radius MCP" onClick={() => void act("configure-mcp")}>Add</Button>}
                {state.mcp.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} onClick={() => setRemoval({ action: "remove-mcp", key: state.mcp.removalKey! })} aria-label="Remove Radius MCP">Remove</Button>}
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
                    {!webSearchReady && <Button variant="outline" size="sm" disabled={disabled || state.webSearch.status === "blocked" || !signedIn} aria-label="Install web search" onClick={() => void act("install-web-search")}>Install</Button>}
                    {state.webSearch.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} onClick={() => setRemoval({ action: "uninstall-web-search", key: state.webSearch.removalKey! })} aria-label="Uninstall web search">Uninstall</Button>}
                  </>}
              </ItemActions>
            </Item>
          </ItemGroup>
        </section>
      </>}
    {state?.installation.status === "error" && <Alert variant="destructive"><AlertTitle>{state.installation.action === "uninstall" ? "Web search was not uninstalled" : "Web search was not installed"}</AlertTitle><AlertDescription>{state.installation.detail}</AlertDescription></Alert>}
     </section>
    </div>
    <Dialog open={!!removal} onOpenChange={open => { if (!open && !busy) setRemoval(undefined); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{removal?.action === "remove-mcp" ? "Remove Radius MCP?" : "Uninstall web search?"}</DialogTitle>
          <DialogDescription>
            {removal?.action === "remove-mcp"
              ? "Removes Radius MCP from Pi on this machine."
              : "Removes the Radius web-search extension from Pi on this machine."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setRemoval(undefined)}>Cancel</Button>
          <Button variant="destructive" disabled={disabled} onClick={() => { if (removal) void act(removal.action, removal.key); }}>
            {busy && <Spinner data-icon="inline-start" />}{removal?.action === "remove-mcp" ? "Remove" : "Uninstall"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmSignOut && <ProviderSignOutDialog name="Radius" busy={signingOut} cancel={() => setConfirmSignOut(false)} confirm={() => void signOut()} />}
    {login && <ProviderLoginDialog key={login} initialProvider="radius" providers={providers} close={() => { setLogin(undefined); setRevision(value => value + 1); }} signedIn={refreshProviders} />}
  </section>;
}

/** A quiet check beside a title once that part is ready; screen readers hear the label. */
function ReadyMark({ ready, label }: { ready: boolean; label: string }) {
  if (!ready) return null;
  return <><CheckCircle2Icon className="size-3.5 text-brand" aria-hidden /><span className="sr-only">({label})</span></>;
}
