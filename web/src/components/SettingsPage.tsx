import type { OAuthProvider } from "@shared/wire";
import { AlertCircleIcon, HomeIcon, PanelLeftOpenIcon, PlugIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LayoutHeader, LayoutRail } from "@/components/AppLayout";
import { IconButton } from "@/components/IconButton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsNavigation({ compact, onShow, onHide, onSelect, onHome }: { compact: boolean; onShow: () => void; onHide: () => void; onSelect: () => void; onHome: () => void }) {
  const menu = <nav aria-label="Settings sections" className={compact ? "w-full px-2" : undefined}>
    <SidebarMenu><SidebarMenuItem>
      <SidebarMenuButton isActive aria-current="page" aria-label="Providers" tooltip="Providers" className={compact ? "size-8 justify-center p-2" : "h-9 pointer-coarse:h-11"} onClick={onSelect}>
        <PlugIcon />{!compact && <span>Providers</span>}
      </SidebarMenuButton>
    </SidebarMenuItem></SidebarMenu>
  </nav>;
  return compact ? <LayoutRail onShow={onShow} footer={<IconButton label="Home" side="right" onClick={onHome}><HomeIcon /></IconButton>}>{menu}</LayoutRail> : <div className="flex h-full flex-col">
    <LayoutHeader title="Settings" onHide={onHide} />
    <SidebarContent><SidebarGroup className="px-3"><SidebarGroupContent>{menu}</SidebarGroupContent></SidebarGroup></SidebarContent>
    <div className="shrink-0 p-3">
      <Button variant="ghost" className="w-full justify-start" onClick={onHome}><HomeIcon data-icon="inline-start" />Home</Button>
    </div>
  </div>;
}

export function SettingsPage({ onMenu, providersChanged }: { onMenu: () => void; providersChanged: () => void }) {
  const [providers, setProviders] = useState<OAuthProvider[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [login, setLogin] = useState<{ provider: string; key: string }>();
  const [signingOut, setSigningOut] = useState<string>();
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
  const refreshProviders = useCallback(() => {
    setRevision(value => value + 1);
    providersChanged();
  }, [providersChanged]);
  const signOut = async (provider: OAuthProvider) => {
    setSigningOut(provider.id);
    try {
      const response = await fetch("/api/provider-logout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: provider.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not sign out. Try again.");
      refreshProviders();
      toast.success(`Signed out of ${provider.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out. Try again.");
    } finally { setSigningOut(undefined); }
  };
  return <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 lg:p-10">
        <section id="settings-providers" aria-labelledby="settings-providers-title" className="mx-auto flex max-w-2xl flex-col gap-6">
          <header className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
              <h1 id="settings-providers-title" className="text-xl font-semibold">Providers</h1>
            </div>
            <p className="text-sm text-muted-foreground">Connect your AI subscriptions through Pi.</p>
          </header>
          {error ? <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not load providers</AlertTitle>
            <AlertDescription>
              <p>Check your connection and try again.</p>
              <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>Retry</Button>
            </AlertDescription>
          </Alert>
            : !providers ? <div role="status" className="flex flex-col gap-2">
              <span className="sr-only">Loading providers…</span>
              {[0, 1, 2].map(row => <Skeleton key={row} className="h-16 w-full" />)}
            </div>
            : providers.length === 0 ? <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><PlugIcon /></EmptyMedia>
                <EmptyTitle>No OAuth providers available</EmptyTitle>
                <EmptyDescription>Providers supported by Pi will appear here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
            : <ItemGroup className="gap-2">{providers.map(provider => <Item key={provider.id} role="listitem" variant="outline" className="flex-nowrap">
              <ItemContent className="min-w-0">
                <ItemTitle className="flex-wrap">{provider.name}{provider.signedIn && <Badge variant="secondary">Signed in</Badge>}</ItemTitle>
              </ItemContent>
              <ItemActions className="shrink-0">
                <Button variant="outline" size="sm" disabled={!!signingOut} aria-label={`${provider.signedIn ? "Sign out of" : "Sign in to"} ${provider.name}`} onClick={() => {
                  if (provider.signedIn) void signOut(provider);
                  else setLogin({ provider: provider.id, key: crypto.randomUUID() });
                }}>{signingOut === provider.id ? "Signing out…" : provider.signedIn ? "Sign out" : "Sign in"}</Button>
              </ItemActions>
            </Item>)}</ItemGroup>}
        </section>
      </div>
    {login && <ProviderLoginDialog key={login.key} initialProvider={login.provider} providers={providers ?? []} close={() => setLogin(undefined)} signedIn={refreshProviders} />}
  </section>;
}
