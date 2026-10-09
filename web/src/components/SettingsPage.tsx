import type { OAuthProvider } from "@shared/wire";
import { ArrowLeftIcon, PanelLeftOpenIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";

export function SettingsPage({ close, onMenu, signedIn }: { close: () => void; onMenu: () => void; signedIn: () => void }) {
  const [providers, setProviders] = useState<OAuthProvider[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [login, setLogin] = useState<{ provider: string; key: string }>();
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch("/api/oauth-providers", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load providers.");
      const result = await response.json();
      if (!controller.signal.aborted) setProviders(result.providers);
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load providers."); });
    return () => controller.abort();
  }, [revision]);
  const refreshAfterSignIn = useCallback(() => {
    setRevision(value => value + 1);
    signedIn();
  }, [signedIn]);
  return <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
    <header className="flex shrink-0 items-center gap-2 p-4">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
      <Button variant="ghost" size="icon" aria-label="Back to session" onClick={close}><ArrowLeftIcon /></Button>
      <h1 className="text-lg font-semibold">Settings</h1>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h2 className="text-base font-medium">Providers</h2>
        <p className="text-sm text-muted-foreground">Connect an OAuth provider through Pi.</p>
        {error ? <div role="alert" className="flex items-center gap-3"><p>{error}</p><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Retry</Button></div>
          : !providers ? <p role="status">Loading providers…</p>
          : providers.length === 0 ? <p>No OAuth providers available.</p>
          : <ItemGroup>{providers.map(provider => <Item key={provider.id} size="sm">
            <ItemContent><ItemTitle>{provider.name}</ItemTitle></ItemContent>
            <ItemActions>
              {provider.signedIn && <Badge variant="secondary">Signed in</Badge>}
              <Button variant="outline" size="sm" aria-label={`${provider.signedIn ? "Sign in again to" : "Sign in to"} ${provider.name}`} onClick={() => setLogin({ provider: provider.id, key: crypto.randomUUID() })}>{provider.signedIn ? "Sign in again" : "Sign in"}</Button>
            </ItemActions>
          </Item>)}</ItemGroup>}
      </div>
    </div>
    {login && <ProviderLoginDialog key={login.key} initialProvider={login.provider} close={() => setLogin(undefined)} signedIn={refreshAfterSignIn} />}
  </section>;
}
