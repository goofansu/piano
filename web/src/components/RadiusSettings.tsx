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
import { oauthProviders, providerLogout, type RadiusSetupAction, radiusSetup } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

type Removal = { action: "remove-mcp" | "uninstall-web-search"; key: string };

/** One turn of the refresh icon, so a fast refresh still reads as a refresh instead of a flicker. */
const REFRESH_SPIN_MS = 600;
/** Setup toasts share an id, so finishing setup replaces the step's toast instead of stacking. */
const SETUP_TOAST = "radius-setup";
const INSTALL_POLL_MS = 1500;

export function RadiusSettings({ onMenu }: { onMenu: () => void }) {
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [login, setLogin] = useState<string>();
  // The dialog keeps the last removal's wording while it animates closed.
  const [removal, setRemoval] = useState<Removal>();
  const [removalOpen, setRemovalOpen] = useState(false);
  const confirmRemoval = (next: Removal) => { setRemoval(next); setRemovalOpen(true); };
  const manualRefresh = useRef(false);
  // Web search changes finish in the background; remember one seen to finish here until it can be announced.
  const lastInstallation = useRef<RadiusSetupState["installation"]["status"]>(undefined);
  const finished = useRef<"install" | "uninstall">(undefined);
  const observe = (next: RadiusSetupState) => {
    if (lastInstallation.current === "running" && next.installation.status === "success") finished.current = next.installation.action;
    lastInstallation.current = next.installation.status;
  };
  // A running web-search change is polled until it settles.
  const setup = useObservation<{ state: RadiusSetupState; providers: OAuthProvider[] }>("radius", async signal => {
    const manual = manualRefresh.current;
    manualRefresh.current = false;
    const [next, signIns] = await Promise.all([
      radiusSetup(undefined, { signal }), oauthProviders({ signal }),
      manual && new Promise(resolve => setTimeout(resolve, REFRESH_SPIN_MS)),
    ]);
    if (signal.aborted) throw signal.reason;
    observe(next);
    // A running or just-finished web-search change gets its own toast once it settles.
    if (manual && next.installation.status !== "running" && !finished.current) toast.success("Radius setup refreshed.", { id: SETUP_TOAST });
    return { state: next, providers: [...signIns] };
  }, { interval: value => value?.state.installation.status === "running" ? INSTALL_POLL_MS : undefined });
  const state = setup.value?.state, providers = setup.value?.providers ?? [];
  const refreshing = setup.loading || !setup.value && !setup.error;
  const error = setup.error && !setup.loading ? "Could not refresh Radius setup. Check your connection and try again." : "";
  const { refresh } = setup;
  // Signing in or out changes the usable models; the server invalidates every catalog itself.
  const refreshProviders = useCallback(() => { void refresh(); }, [refresh]);
  const signOut = async () => {
    setSigningOut(true); setActionError("");
    try {
      // Only acknowledge sign-out after Pi confirms credential removal.
      await setup.mutate(async (_signal, previous) => {
        await providerLogout("radius");
        return previous && { ...previous, providers: previous.providers.map(provider => provider.id === "radius" ? { ...provider, signedIn: false } : provider) };
      });
      refreshProviders();
      toast.success("Signed out of Radius.");
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not sign out. Try again."); }
    finally { setSigningOut(false); setConfirmSignOut(false); }
  };
  const act = async (action: RadiusSetupAction, removalKey?: string) => {
    setBusy(true); setActionError("");
    try {
      await setup.mutate(async (_signal, previous) => {
        const next = await radiusSetup({ action, removalKey });
        observe(next);
        return previous && { ...previous, state: next };
      });
      if (action === "configure-mcp") toast.success("Radius MCP added. Start a new session to use it.", { id: SETUP_TOAST });
      if (action === "remove-mcp") toast.success("Radius MCP removed for new sessions.", { id: SETUP_TOAST });
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not complete setup. Refresh before retrying."); }
    finally { setBusy(false); setRemovalOpen(false); void refresh(); }
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
      <IconButton label="Refresh setup" disabled={busy || signingOut || refreshing} onClick={() => { setActionError(""); manualRefresh.current = true; void refresh(); }}>
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
                {!mcpReady && <Button size="sm" disabled={disabled || state.mcp.status === "blocked" || !signedIn} aria-label="Add Radius MCP" onClick={() => void act("configure-mcp")}>Add</Button>}
                {state.mcp.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} onClick={() => confirmRemoval({ action: "remove-mcp", key: state.mcp.removalKey! })} aria-label="Remove Radius MCP">Remove</Button>}
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
                {installing ? <Button variant={state.installation.action === "uninstall" ? "ghost" : "default"} size="sm" disabled><Spinner data-icon="inline-start" />{state.installation.action === "uninstall" ? "Uninstalling…" : "Installing…"}</Button>
                  : <>
                    {!webSearchReady && <Button size="sm" disabled={disabled || state.webSearch.status === "blocked" || !signedIn} aria-label="Install web search" onClick={() => void act("install-web-search")}>Install</Button>}
                    {state.webSearch.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:-mx-2.5" disabled={disabled} onClick={() => confirmRemoval({ action: "uninstall-web-search", key: state.webSearch.removalKey! })} aria-label="Uninstall web search">Uninstall</Button>}
                  </>}
              </ItemActions>
            </Item>
          </ItemGroup>
        </section>
      </>}
    {state?.installation.status === "error" && <Alert variant="destructive"><AlertTitle>{state.installation.action === "uninstall" ? "Web search was not uninstalled" : "Web search was not installed"}</AlertTitle><AlertDescription>{state.installation.detail}</AlertDescription></Alert>}
     </section>
    </div>
    <Dialog open={removalOpen} onOpenChange={open => { if (!open && !busy) setRemovalOpen(false); }}>
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
          <Button variant="outline" disabled={busy} onClick={() => setRemovalOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={disabled} onClick={() => { if (removal && removalOpen) void act(removal.action, removal.key); }}>
            {busy && <Spinner data-icon="inline-start" />}{removal?.action === "remove-mcp" ? "Remove" : "Uninstall"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmSignOut && <ProviderSignOutDialog name="Radius" busy={signingOut} cancel={() => setConfirmSignOut(false)} confirm={() => void signOut()} />}
    {login && <ProviderLoginDialog key={login} initialProvider="radius" providers={providers} close={() => { setLogin(undefined); void refresh(); }} signedIn={refreshProviders} />}
  </section>;
}

/** A quiet check beside a title once that part is ready; screen readers hear the label. */
function ReadyMark({ ready, label }: { ready: boolean; label: string }) {
  if (!ready) return null;
  return <><CheckCircle2Icon className="size-3.5 text-brand" aria-hidden /><span className="sr-only">({label})</span></>;
}
