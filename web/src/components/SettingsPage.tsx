import type { OAuthProvider } from "@shared/wire";
import { cn } from "cn";
import { HomeIcon, MoreHorizontalIcon, PlugIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { ApiKeySettings } from "@/components/ApiKeySettings";
import { LayoutFooter, LayoutHeader } from "@/components/AppLayout";
import { LibrarySettings } from "@/components/LibrarySettings";
import { McpSettings } from "@/components/McpSettings";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { PianoSidebarMenuButton as SidebarMenuButton } from "@/components/PianoSidebarMenuButton";
import { PreferencesSettings } from "@/components/PreferencesSettings";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { RadiusSection } from "@/components/RadiusSection";
import { RemovalDialog, signOutCopy } from "@/components/RemovalDialog";
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import {
  SettingsGroup,
  SettingsList,
  SettingsLoadFailure,
  SettingsSectionFrame,
  SettingsSectionIcon,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { StatusDot } from "@/components/StatusDot";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { WebhookSettings } from "@/components/WebhookSettings";
import { providersSettingsView } from "@/lib/providersSettingsView";
import {
  SETTINGS_PAGES,
  type SettingsPage as SettingsPageId,
  type SettingsSection,
  settingsPage,
} from "@/lib/routes";
import { providerAccounts, useProviderAccounts } from "@/lib/useProviderAccounts";
import { useSetupActions } from "@/lib/useSetupActions";

export type { SettingsSection } from "@/lib/routes";

export function SettingsNavigation({
  section,
  onSelect,
  onHome,
}: {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  onHome: () => void;
}) {
  // Radius addresses the Providers page, so its row stays the current one while Radius shows.
  const current = settingsPage(section);
  const menu = (
    <nav aria-label="Settings sections">
      <SidebarMenu>
        {SETTINGS_PAGES.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              isActive={current === item.id}
              aria-current={current === item.id ? "page" : undefined}
              aria-label={item.label}
              tooltip={item.label}
              onClick={() => onSelect(item.id)}
            >
              <SettingsSectionIcon icon={item.icon} />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </nav>
  );
  return (
    <div className="flex h-full flex-col">
      <LayoutHeader />
      <SidebarContent>
        <SidebarGroup className="px-(--row-inset)">
          <SidebarGroupContent>{menu}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <LayoutFooter>
        <PianoButton variant="ghost" leading className="flex-1" onClick={onHome}>
          <HomeIcon data-icon="inline-start" />
          Home
        </PianoButton>
      </LayoutFooter>
    </div>
  );
}

export function SettingsPage({
  section,
  request,
}: {
  section: SettingsSection;
  /** Navigation's request count, so asking for Radius again reveals it again. */
  request: number;
}) {
  const page = settingsPage(section);
  // Each page; a page named in SETTINGS_SECTIONS without one here fails to typecheck.
  const pages: Record<SettingsPageId, () => React.ReactNode> = {
    providers: () => (
      <ProvidersSettings revealRadius={section === "radius" ? request : undefined} />
    ),
    mcp: () => <McpSettings />,
    skills: () => <LibrarySettings kind="skill" />,
    prompts: () => <LibrarySettings kind="prompt" />,
    webhooks: () => <WebhookSettings />,
    preferences: () => <PreferencesSettings />,
  };
  return pages[page]();
}

function ProvidersSettings({
  revealRadius,
}: {
  /** The request that asked for Radius, or `undefined` when the page was opened for itself. */
  revealRadius: number | undefined;
}) {
  const observed = useProviderAccounts();
  // Opening the page reads again, as returning to it from another page always has.
  useEffect(() => void providerAccounts.refresh(), []);
  // Signing in or out changes the usable models; the server invalidates every catalog itself.
  const actions = useSetupActions<OAuthProvider, string>({
    refresh: () => void providerAccounts.refresh(),
    success: (text) => toast.success(text),
  });
  const { confirmation: signOutTarget, signIn } = actions;
  const signingOut = actions.running;
  const { body, providers } = providersSettingsView({
    value: observed.value,
    // The failure stays while Retry reads again, so the alert does not flicker into a skeleton.
    failure: !!observed.error,
    signingOut,
  });
  const signOut = (provider: OAuthProvider) =>
    actions.run({
      id: provider.id,
      run: () => providerAccounts.signOut(provider.id),
      done: `Signed out of ${provider.name}`,
      fallback: "Could not sign out. Try again.",
    });
  return (
    <SettingsSectionFrame
      title="Providers"
      titleId="settings-providers-title"
      sectionId="settings-providers"
      dialogs={
        <>
          <RemovalDialog
            open={!!signOutTarget}
            busy={!!signingOut}
            cancel={actions.cancel}
            {...signOutCopy(signOutTarget?.name)}
            confirm={() => {
              if (signOutTarget) void signOut(signOutTarget);
            }}
          />
          <ProviderLoginDialog
            signIn={signIn && { key: signIn.key, provider: signIn.subject }}
            providers={providers}
            close={actions.closeSignIn}
            signedIn={() => void providerAccounts.signedIn()}
          />
        </>
      }
    >
      <div className="flex flex-col gap-8">
        <RadiusSection reveal={revealRadius} />
        {body.kind !== "hidden" && (
          <SettingsGroup id="settings-accounts" title="Accounts">
            {body.kind === "error" ? (
              <SettingsLoadFailure
                title="Could not load providers"
                retrying={observed.loading}
                retry={() => void providerAccounts.refresh()}
              />
            ) : body.kind === "loading" ? (
              <SettingsSkeleton label="Loading providers…" className="flex flex-col gap-2">
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} className="h-14 w-full rounded-lg" />
                ))}
              </SettingsSkeleton>
            ) : body.kind === "empty" ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PlugIcon />
                  </EmptyMedia>
                  <EmptyTitle>No OAuth providers available</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <SettingsList>
                {body.rows.map(({ provider, logo, action }) => (
                  <Item
                    key={provider.id}
                    role="listitem"
                    data-row
                    className={cn(
                      settingsRow,
                      "relative",
                      rowActionsWidth.list[provider.signedIn ? 1 : 0],
                    )}
                  >
                    {logo && (
                      <ItemMedia variant="icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <use href={`/provider-logos/${logo}.svg#logo`} />
                        </svg>
                      </ItemMedia>
                    )}
                    <ItemContent data-motion="yield" className="min-w-0 gap-0.5">
                      <ItemTitle>{provider.name}</ItemTitle>
                      {provider.signedIn && (
                        <p className="flex items-center gap-1.5 text-xs text-ink-3">
                          <StatusDot tone="ok" />
                          Signed in
                        </p>
                      )}
                    </ItemContent>
                    {action.intent === "confirm-sign-out" ? (
                      <RowActions className="top-1/2 right-3 -translate-y-1/2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <PianoButton
                              variant="ghost"
                              size="list"
                              aria-label={`${provider.name} account actions`}
                              disabled={!action.enabled}
                            >
                              <MoreHorizontalIcon />
                            </PianoButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => actions.confirm(provider)}
                            >
                              Sign out
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </RowActions>
                    ) : (
                      <ItemActions className="shrink-0">
                        <PianoButton
                          variant="outline"
                          size="sm"
                          disabled={!action.enabled}
                          aria-label={action.ariaLabel}
                          onClick={() => actions.openSignIn(provider.id)}
                        >
                          {action.label}
                        </PianoButton>
                      </ItemActions>
                    )}
                  </Item>
                ))}
              </SettingsList>
            )}
          </SettingsGroup>
        )}
        <ApiKeySettings />
      </div>
    </SettingsSectionFrame>
  );
}
