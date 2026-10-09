import type { RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

async function setupRequest(action?: "configure-mcp" | "install-web-search", signal?: AbortSignal): Promise<RadiusSetupState> {
  const response = await fetch("/api/settings/radius", { signal, ...(action ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
  } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load Radius setup.");
  return result.state;
}

export function RadiusSettings({ providersChanged }: { providersChanged: () => void }) {
  const [state, setState] = useState<RadiusSetupState>();
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let installing = false;
    const load = async () => {
      try {
        const [next, response] = await Promise.all([setupRequest(undefined, controller.signal), fetch("/api/oauth-providers", { signal: controller.signal })]);
        if (!response.ok) throw new Error("Could not load Radius sign-in status.");
        const result = await response.json();
        if (controller.signal.aborted) return;
        setProviders(result.providers); setState(next); setError("");
        installing = next.installation.status === "running";
      } catch { if (!controller.signal.aborted) setError("Could not refresh Radius setup. Check your connection and try again."); }
      if (!controller.signal.aborted && installing) timer = setTimeout(load, 1500);
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);
  const signedIn = useCallback(() => { setRevision(value => value + 1); providersChanged(); }, [providersChanged]);
  const act = async (action: "configure-mcp" | "install-web-search") => {
    setBusy(true); setActionError("");
    try {
      setState(await setupRequest(action));
      if (action === "configure-mcp") toast.success("Radius MCP configured. Start a new session to use it.");
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not complete setup. Refresh before retrying."); }
    finally { setBusy(false); setRevision(value => value + 1); }
  };
  const radius = providers.find(provider => provider.id === "radius");
  const installing = state?.installation.status === "running";
  const disabled = busy || installing || !!error;
  return <>
    <p className="text-sm text-muted-foreground">Connect your Radius account and tools on this machine. Changes apply to new sessions.</p>
    {(error || actionError) && <Alert variant="destructive"><AlertTitle>Radius setup needs attention</AlertTitle><AlertDescription>{error || actionError}</AlertDescription></Alert>}
    {!state ? <div role="status" className="flex flex-col gap-3"><span className="sr-only">Loading Radius setup…</span>{[0, 1, 2].map(row => <Skeleton key={row} className="h-28 w-full" />)}</div>
      : <ItemGroup className="gap-3">
        <Item variant="outline" role="listitem" className="flex-col items-start sm:flex-row sm:items-center">
          <ItemContent className="w-full min-w-0 sm:w-auto">
            <ItemTitle>1. Sign in to Radius</ItemTitle>
            <ItemDescription className="line-clamp-none">Use OAuth to connect your account. Pi stores and refreshes the credentials.</ItemDescription>
            {!radius && <p className="text-sm text-muted-foreground">Radius OAuth is unavailable in this Pi installation.</p>}
          </ItemContent>
          <ItemActions>{radius?.signedIn ? <Badge variant="secondary">Signed in</Badge>
            : <Button variant="outline" size="sm" disabled={disabled || !radius} onClick={() => setLogin(crypto.randomUUID())}>Sign in to Radius</Button>}</ItemActions>
        </Item>
        <Item variant="outline" role="listitem" className="flex-col items-start sm:flex-row sm:items-center">
          <ItemContent className="w-full min-w-0 sm:w-auto">
            <ItemTitle>2. Set up Radius MCP</ItemTitle>
            <ItemDescription className="line-clamp-none">Give Pi access to Radius tools using the same sign-in, without a second OAuth flow.</ItemDescription>
            {state.mcp.detail && <p className="text-sm text-muted-foreground">{state.mcp.detail}</p>}
          </ItemContent>
          <ItemActions>{state.mcp.status === "ready" ? <Badge variant="secondary">Configured</Badge>
            : <Button variant="outline" size="sm" disabled={disabled || state.mcp.status === "blocked" || !radius?.signedIn} onClick={() => void act("configure-mcp")}>Set up MCP</Button>}</ItemActions>
        </Item>
        <Item variant="outline" role="listitem" className="flex-col items-start sm:flex-row sm:items-center">
          <ItemContent className="w-full min-w-0 sm:w-auto">
            <ItemTitle>3. Install web search</ItemTitle>
            <ItemDescription className="line-clamp-none">Install the official Radius web-search extension for Pi.</ItemDescription>
            <p className="text-sm text-muted-foreground">An organization owner or admin must enable Web search separately in Radius.</p>
            {state.webSearch.detail && <p className="text-sm text-muted-foreground">{state.webSearch.detail}</p>}
          </ItemContent>
          <ItemActions>{installing ? <Button variant="outline" size="sm" disabled><Spinner data-icon="inline-start" />Installing…</Button>
            : state.webSearch.status === "ready" ? <Badge variant="secondary" role="status">Installed</Badge>
            : <Button variant="outline" size="sm" disabled={disabled || state.webSearch.status === "blocked" || !radius?.signedIn} onClick={() => void act("install-web-search")}>Install web search</Button>}</ItemActions>
        </Item>
      </ItemGroup>}
    {state?.installation.status === "error" && <Alert variant="destructive"><AlertTitle>Web search was not installed</AlertTitle><AlertDescription>{state.installation.detail}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setActionError(""); setRevision(value => value + 1); }}><RefreshCwIcon data-icon="inline-start" />Refresh setup</Button>
      <Button asChild variant="link" size="sm"><a href="https://radius.earendil.com/docs/extensions" target="_blank" rel="noopener noreferrer">Radius setup guide<ExternalLinkIcon data-icon="inline-end" /></a></Button>
    </div>
    {login && <ProviderLoginDialog key={login} initialProvider="radius" providers={providers} close={() => { setLogin(undefined); setRevision(value => value + 1); }} signedIn={signedIn} />}
  </>;
}
