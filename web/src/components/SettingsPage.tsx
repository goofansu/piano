import type { OAuthProvider } from "@shared/wire";
import { AlertCircleIcon, CheckCircle2Icon, HomeIcon, PlugIcon, RadiusIcon, ServerIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { LayoutHeader, LayoutRail } from "@/components/AppLayout";
import { IconButton } from "@/components/IconButton";
import { McpSettings } from "@/components/McpSettings";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { RadiusSettings } from "@/components/RadiusSettings";
import { SettingsHeader } from "@/components/SettingsHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

import { oauthProviders, providerLogout } from "@/lib/api";
import type { SettingsSection } from "@/lib/routes";
import { useObservation } from "@/lib/useObservation";

export type { SettingsSection } from "@/lib/routes";

const SECTIONS = [{ id: "providers", label: "Providers", icon: PlugIcon }, { id: "radius", label: "Radius", icon: RadiusIcon }, { id: "mcp", label: "MCP", icon: ServerIcon }] as const;

export function SettingsNavigation({ compact, section, onShow, onHide, onSelect, onHome }: { compact: boolean; section: SettingsSection; onShow: () => void; onHide: () => void; onSelect: (section: SettingsSection) => void; onHome: () => void }) {
  const menu = <nav aria-label="Settings sections" className={compact ? "w-full px-2" : undefined}>
    <SidebarMenu>{SECTIONS.map(item => <SidebarMenuItem key={item.id}>
      <SidebarMenuButton isActive={section === item.id} aria-current={section === item.id ? "page" : undefined} aria-label={item.label} tooltip={item.label} className={compact ? "size-8 justify-center p-2" : "h-9 pointer-coarse:h-11"} onClick={() => onSelect(item.id)}>
        <item.icon />{!compact && <span>{item.label}</span>}
      </SidebarMenuButton>
    </SidebarMenuItem>)}</SidebarMenu>
  </nav>;
  return compact ? <LayoutRail onShow={onShow} footer={<IconButton label="Home" side="right" onClick={onHome}><HomeIcon /></IconButton>}>{menu}</LayoutRail> : <div className="flex h-full flex-col">
    <LayoutHeader title="Settings" onHide={onHide} />
    <SidebarContent><SidebarGroup className="px-3"><SidebarGroupContent>{menu}</SidebarGroupContent></SidebarGroup></SidebarContent>
    <div className="shrink-0 p-3">
      <Button variant="ghost" className="w-full justify-start" onClick={onHome}><HomeIcon data-icon="inline-start" />Home</Button>
    </div>
  </div>;
}

export function SettingsPage({ section, onMenu }: { section: SettingsSection; onMenu: () => void }) {
  // Kept while another section shows; returning to Providers reads them again.
  const observed = useObservation("providers", signal => oauthProviders({ signal }), { enabled: section === "providers" });
  const providers = observed.value && [...observed.value];
  const error = observed.error && !observed.loading ? "Could not load providers." : "";
  const [login, setLogin] = useState<{ provider: string; key: string }>();
  const [signingOut, setSigningOut] = useState<string>();
  const [signOutTarget, setSignOutTarget] = useState<OAuthProvider>();
  const { refresh } = observed;
  // Signing in or out changes the usable models; the server invalidates every catalog itself.
  const refreshProviders = useCallback(() => { void refresh(); }, [refresh]);
  const signOut = async (provider: OAuthProvider) => {
    setSigningOut(provider.id);
    try {
      await providerLogout(provider.id);
      refreshProviders();
      toast.success(`Signed out of ${provider.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out. Try again.");
    } finally { setSigningOut(undefined); setSignOutTarget(undefined); }
  };
  if (section === "radius") return <RadiusSettings onMenu={onMenu} />;
  if (section === "mcp") return <McpSettings onMenu={onMenu} />;
  return <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
      <SettingsHeader title="Providers" titleId="settings-providers-title" onMenu={onMenu} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 lg:p-10">
        <section id="settings-providers" aria-labelledby="settings-providers-title" className="mx-auto flex max-w-2xl flex-col gap-6">
          {error ? <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not load providers</AlertTitle>
            <AlertDescription>
              <p>Check your connection and try again.</p>
              <Button variant="outline" size="sm" onClick={() => void observed.refresh()}>Retry</Button>
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
                <ItemTitle>{provider.name}{provider.signedIn && <><CheckCircle2Icon className="size-3.5 text-brand" aria-hidden /><span className="sr-only">(Signed in)</span></>}</ItemTitle>
              </ItemContent>
              <ItemActions className="shrink-0">
                <Button variant={provider.signedIn ? "ghost" : "default"} size="sm" className={provider.signedIn ? "text-muted-foreground" : undefined} disabled={!!signingOut} aria-label={`${provider.signedIn ? "Sign out of" : "Sign in to"} ${provider.name}`} onClick={() => {
                  if (provider.signedIn) setSignOutTarget(provider);
                  else setLogin({ provider: provider.id, key: crypto.randomUUID() });
                }}>{signingOut === provider.id ? "Signing out…" : provider.signedIn ? "Sign out" : "Sign in"}</Button>
              </ItemActions>
            </Item>)}</ItemGroup>}
        </section>
      </div>
    {signOutTarget && <ProviderSignOutDialog name={signOutTarget.name} busy={!!signingOut} cancel={() => setSignOutTarget(undefined)} confirm={() => void signOut(signOutTarget)} />}
    {login && <ProviderLoginDialog key={login.key} initialProvider={login.provider} providers={providers ?? []} close={() => setLogin(undefined)} signedIn={refreshProviders} />}
  </section>;
}
