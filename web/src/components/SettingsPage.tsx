import type { OAuthProvider } from "@shared/wire";
import { AlertCircleIcon, CheckCircle2Icon, HomeIcon, PlugIcon } from "lucide-react";
import { toast } from "sonner";
import { LayoutHeader, LayoutRail } from "@/components/AppLayout";
import { IconButton } from "@/components/IconButton";
import { McpSettings } from "@/components/McpSettings";
import { PianoSidebarMenuButton as SidebarMenuButton } from "@/components/PianoSidebarMenuButton";
import { PianoSkeleton as Skeleton } from "@/components/PianoSkeleton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { RadiusSection } from "@/components/RadiusSection";
import {
  SettingsAlert,
  SettingsSectionFrame,
  SettingsSectionIcon,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { oauthProviders, providerLogout } from "@/lib/api";
import {
  SETTINGS_PAGES,
  type SettingsPage as SettingsPageId,
  type SettingsSection,
  settingsPage,
} from "@/lib/routes";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

export type { SettingsSection } from "@/lib/routes";

// Pi owns the provider catalog; unknown/custom providers intentionally have no logo. Radius is
// absent because its own section, not a list row, carries it.
const PROVIDER_LOGOS: Readonly<Record<string, string | undefined>> = {
  anthropic: "anthropic",
  openai: "openai",
  "github-copilot": "github-copilot",
  "kimi-coding": "kimi",
  meta: "meta",
  openrouter: "openrouter",
  xai: "xai",
};

export function SettingsNavigation({
  compact,
  section,
  onShow,
  onHide,
  onSelect,
  onHome,
}: {
  compact: boolean;
  section: SettingsSection;
  onShow: () => void;
  onHide: () => void;
  onSelect: (section: SettingsSection) => void;
  onHome: () => void;
}) {
  // Radius addresses the Providers page, so its row stays the current one while Radius shows.
  const current = settingsPage(section);
  const menu = (
    <nav aria-label="Settings sections" className={compact ? "w-full px-2" : undefined}>
      <SidebarMenu>
        {SETTINGS_PAGES.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              isActive={current === item.id}
              aria-current={current === item.id ? "page" : undefined}
              aria-label={item.label}
              tooltip={item.label}
              className={compact ? "size-8 justify-center p-2" : "h-9 pointer-coarse:h-11"}
              onClick={() => onSelect(item.id)}
            >
              <SettingsSectionIcon icon={item.icon} />
              {!compact && <span>{item.label}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </nav>
  );
  return compact ? (
    <LayoutRail
      onShow={onShow}
      footer={
        <IconButton label="Home" side="right" onClick={onHome}>
          <HomeIcon />
        </IconButton>
      }
    >
      {menu}
    </LayoutRail>
  ) : (
    <div className="flex h-full flex-col">
      <LayoutHeader title="Settings" onHide={onHide} />
      <SidebarContent>
        <SidebarGroup className="px-3">
          <SidebarGroupContent>{menu}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div className="shrink-0 p-3">
        <Button variant="ghost" className="w-full justify-start" onClick={onHome}>
          <HomeIcon data-icon="inline-start" />
          Home
        </Button>
      </div>
    </div>
  );
}

export function SettingsPage({
  section,
  request,
  onMenu,
}: {
  section: SettingsSection;
  /** Navigation's request count, so asking for Radius again reveals it again. */
  request: number;
  onMenu: () => void;
}) {
  const page = settingsPage(section);
  // Kept while another page shows; returning to Providers reads them again.
  const providers = useObservation("providers", (signal) => oauthProviders({ signal }), {
    enabled: page === "providers",
  });
  // Each page; a page named in SETTINGS_SECTIONS without one here fails to typecheck.
  const pages: Record<SettingsPageId, () => React.ReactNode> = {
    providers: () => (
      <ProvidersSettings
        observed={providers}
        revealRadius={section === "radius" ? request : undefined}
        onMenu={onMenu}
      />
    ),
    mcp: () => <McpSettings onMenu={onMenu} />,
  };
  return pages[page]();
}

function ProvidersSettings({
  observed,
  revealRadius,
  onMenu,
}: {
  observed: ReturnType<typeof useObservation<readonly OAuthProvider[]>>;
  /** The request that asked for Radius, or `undefined` when the page was opened for itself. */
  revealRadius: number | undefined;
  onMenu: () => void;
}) {
  // Radius has its own section below, with the steps that sign-in alone does not cover.
  const providers = observed.value?.filter((provider) => provider.id !== "radius");
  const catalogEmpty = observed.value?.length === 0;
  const error = observed.error && !observed.loading ? "Could not load providers." : "";
  // Signing in or out changes the usable models; the server invalidates every catalog itself.
  const actions = useSetupActions<OAuthProvider, string>({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
    failure: (text) => toast.error(text),
  });
  const { confirmation: signOutTarget, confirming, signIn } = actions;
  const signingOut = actions.running;
  const signOut = (provider: OAuthProvider) =>
    actions.run({
      id: provider.id,
      run: () => providerLogout(provider.id),
      done: `Signed out of ${provider.name}.`,
      fallback: "Could not sign out. Try again.",
    });
  return (
    <SettingsSectionFrame
      title="Providers"
      titleId="settings-providers-title"
      sectionId="settings-providers"
      onMenu={onMenu}
      dialogs={
        <>
          {confirming && signOutTarget && (
            <ProviderSignOutDialog
              name={signOutTarget.name}
              busy={!!signingOut}
              cancel={actions.cancel}
              confirm={() => void signOut(signOutTarget)}
            />
          )}
          {signIn && (
            <ProviderLoginDialog
              key={signIn.key}
              initialProvider={signIn.subject}
              providers={providers ?? []}
              close={actions.closeSignIn}
              signedIn={() => void observed.refresh()}
            />
          )}
        </>
      }
    >
      {error ? (
        <SettingsAlert title="Could not load providers" icon={<AlertCircleIcon />}>
          <p>Check your connection and try again.</p>
          <Button variant="outline" size="sm" onClick={() => void observed.refresh()}>
            Retry
          </Button>
        </SettingsAlert>
      ) : !providers ? (
        <SettingsSkeleton label="Loading providers…" className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </SettingsSkeleton>
      ) : providers.length === 0 ? (
        // Radius alone is already covered by its own section below; only a catalog with nothing
        // in it needs explaining.
        catalogEmpty && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugIcon />
              </EmptyMedia>
              <EmptyTitle>No OAuth providers available</EmptyTitle>
              <EmptyDescription>Providers supported by Pi will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <ItemGroup className="gap-2">
          {providers.map((provider) => (
            <Item key={provider.id} role="listitem" variant="outline" className="flex-nowrap">
              {Object.hasOwn(PROVIDER_LOGOS, provider.id) && PROVIDER_LOGOS[provider.id] && (
                <ItemMedia variant="icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <use href={`/provider-logos/${PROVIDER_LOGOS[provider.id]}.svg#logo`} />
                  </svg>
                </ItemMedia>
              )}
              <ItemContent className="min-w-0">
                <ItemTitle>
                  {provider.name}
                  {provider.signedIn && (
                    <>
                      <CheckCircle2Icon className="size-3.5 text-brand" aria-hidden />
                      <span className="sr-only">(Signed in)</span>
                    </>
                  )}
                </ItemTitle>
              </ItemContent>
              <ItemActions className="shrink-0">
                <Button
                  variant={provider.signedIn ? "ghost" : "default"}
                  size="sm"
                  className={provider.signedIn ? "text-muted-foreground" : undefined}
                  disabled={!!signingOut}
                  aria-label={`${provider.signedIn ? "Sign out of" : "Sign in to"} ${provider.name}`}
                  onClick={() => {
                    if (provider.signedIn) actions.confirm(provider);
                    else actions.openSignIn(provider.id);
                  }}
                >
                  {signingOut === provider.id
                    ? "Signing out…"
                    : provider.signedIn
                      ? "Sign out"
                      : "Sign in"}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      {/* Radius is reached last, so it waits for the list above to take its height before scrolling. */}
      <RadiusSection reveal={revealRadius} listed={!!providers || !!error} />
    </SettingsSectionFrame>
  );
}
