import type { OAuthProvider } from "@shared/wire";
import { AlertCircleIcon, ArrowLeftIcon, PanelLeftOpenIcon, PlugIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

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
    <Separator />
    <SidebarProvider className="min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <Sidebar collapsible="none" className="h-auto w-full shrink-0 md:h-full md:w-48">
        <SidebarContent>
          <SidebarGroup className="p-4">
            <SidebarGroupLabel className="hidden md:flex">Sections</SidebarGroupLabel>
            <SidebarGroupContent>
              <nav aria-label="Settings sections">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive>
                      <a href="#settings-providers" aria-current="page"><PlugIcon /><span>Providers</span></a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 lg:p-10">
        <section id="settings-providers" aria-labelledby="settings-providers-title" className="mx-auto flex max-w-2xl flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h2 id="settings-providers-title" className="text-xl font-semibold">Providers</h2>
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
                <Button variant="outline" size="sm" aria-label={`${provider.signedIn ? "Sign in again to" : "Sign in to"} ${provider.name}`} onClick={() => setLogin({ provider: provider.id, key: crypto.randomUUID() })}>{provider.signedIn ? "Sign in again" : "Sign in"}</Button>
              </ItemActions>
            </Item>)}</ItemGroup>}
        </section>
      </div>
    </SidebarProvider>
    {login && <ProviderLoginDialog key={login.key} initialProvider={login.provider} close={() => setLogin(undefined)} signedIn={refreshAfterSignIn} />}
  </section>;
}
