import type { RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";
import { CheckCircleIcon, ExternalLinkIcon, PanelLeftOpenIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
    finally { setSigningOut(false); }
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
  return <>
    <header className="flex items-center gap-2">
      <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
      <h1 id="settings-section-title" className="text-xl font-semibold">Radius</h1>
      {configured && <Tooltip>
        <TooltipTrigger asChild><CheckCircleIcon className="size-4 text-brand" role="img" aria-label="Radius setup configured" tabIndex={0} /></TooltipTrigger>
        <TooltipContent>All three setup steps are configured.</TooltipContent>
      </Tooltip>}
      <IconButton className="ml-auto" label="Refresh setup" disabled={busy || signingOut || refreshing} onClick={() => { setActionError(""); setRevision(value => value + 1); }}>
        {refreshing ? <Spinner /> : <RefreshCwIcon />}
      </IconButton>
    </header>
    {(error || actionError) && <Alert variant="destructive"><AlertTitle>Radius setup needs attention</AlertTitle><AlertDescription>{error || actionError}</AlertDescription></Alert>}
    {!state ? <div role="status" className="flex flex-col gap-3"><span className="sr-only">Loading Radius setup…</span>{[0, 1, 2].map(row => <Skeleton key={row} className="h-28 w-full" />)}</div>
      : <ItemGroup className="gap-3">
        <Item variant="outline" role="listitem" className="flex-col items-start sm:flex-row sm:items-center">
          <ItemContent className="w-full min-w-0 sm:w-auto">
            <ItemTitle>1. Sign in to Radius</ItemTitle>
            <ItemDescription className="line-clamp-none">Use OAuth to connect your account. Pi stores and refreshes the credentials.</ItemDescription>
            {!radius && <p className="text-sm text-muted-foreground">Radius OAuth is unavailable in this Pi installation.</p>}
          </ItemContent>
          <ItemActions className="flex-wrap">
            {radius?.signedIn ? <>
              <Badge variant="secondary">Signed in</Badge>
              <Button variant="outline" size="sm" disabled={disabled} aria-label="Sign out of Radius" onClick={() => void signOut()}>
                {signingOut && <Spinner data-icon="inline-start" />}{signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </> : <Button variant="outline" size="sm" disabled={disabled || !radius} onClick={() => setLogin(crypto.randomUUID())}>Sign in to Radius</Button>}
          </ItemActions>
        </Item>
        <Item variant="outline" role="listitem" className="flex-col items-start sm:flex-row sm:items-center">
          <ItemContent className="w-full min-w-0 sm:w-auto">
            <ItemTitle>2. Set up Radius MCP</ItemTitle>
            <ItemDescription className="line-clamp-none">Give Pi access to Radius tools using the same sign-in, without a second OAuth flow.</ItemDescription>
            {state.mcp.detail && <p className="text-sm text-muted-foreground">{state.mcp.detail}</p>}
          </ItemContent>
          <ItemActions className="flex-wrap">{state.mcp.status === "ready" ? <Badge variant="secondary">Configured</Badge>
            : <Button variant="outline" size="sm" disabled={disabled || state.mcp.status === "blocked" || !radius?.signedIn} onClick={() => void act("configure-mcp")}>Set up MCP</Button>}
            {state.mcp.removalKey && <Button variant="outline" size="sm" disabled={disabled} onClick={() => setRemoval({ action: "remove-mcp", key: state.mcp.removalKey! })}>Remove MCP</Button>}
          </ItemActions>
        </Item>
        <Item variant="outline" role="listitem" className="flex-col items-start sm:flex-row sm:items-center">
          <ItemContent className="w-full min-w-0 sm:w-auto">
            <ItemTitle>3. Install web search</ItemTitle>
            <ItemDescription className="line-clamp-none">Install the official Radius web-search extension for Pi.</ItemDescription>
            <p className="text-sm text-muted-foreground">An organization owner or admin must enable Web search separately in Radius.</p>
            {state.webSearch.detail && <p className="text-sm text-muted-foreground">{state.webSearch.detail}</p>}
          </ItemContent>
          <ItemActions className="flex-wrap">{installing ? <Button variant="outline" size="sm" disabled><Spinner data-icon="inline-start" />{state.installation.action === "uninstall" ? "Uninstalling…" : "Installing…"}</Button>
            : <>
              {state.webSearch.status === "ready" ? <Badge variant="secondary" role="status">Installed</Badge>
                : <Button variant="outline" size="sm" disabled={disabled || state.webSearch.status === "blocked" || !radius?.signedIn} onClick={() => void act("install-web-search")}>Install web search</Button>}
              {state.webSearch.removalKey && <Button variant="outline" size="sm" disabled={disabled} onClick={() => setRemoval({ action: "uninstall-web-search", key: state.webSearch.removalKey! })}>Uninstall extension</Button>}
            </>}
          </ItemActions>
        </Item>
      </ItemGroup>}
    {state?.installation.status === "error" && <Alert variant="destructive"><AlertTitle>{state.installation.action === "uninstall" ? "Extension was not uninstalled" : "Web search was not installed"}</AlertTitle><AlertDescription>{state.installation.detail}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="link" size="sm"><a href="https://radius.earendil.com/docs/extensions" target="_blank" rel="noopener noreferrer">Radius setup guide<ExternalLinkIcon data-icon="inline-end" /></a></Button>
    </div>
    <Dialog open={!!removal} onOpenChange={open => { if (!open && !busy) setRemoval(undefined); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{removal?.action === "remove-mcp" ? "Remove Radius MCP?" : "Uninstall web-search extension?"}</DialogTitle>
          <DialogDescription>
            {removal?.action === "remove-mcp"
              ? "Removes the Radius MCP entry from your Pi configuration on this machine. Your sign-in and web-search extension stay unchanged."
              : "Uninstalls the Radius web-search package from your Pi setup on this machine. Your sign-in and MCP configuration stay unchanged."}
            {" "}Existing sessions are not reloaded. Start a new session to use the updated setup.
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
    {login && <ProviderLoginDialog key={login} initialProvider="radius" providers={providers} close={() => { setLogin(undefined); setRevision(value => value + 1); }} signedIn={refreshProviders} />}
  </>;
}
