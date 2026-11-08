import type { OAuthProvider } from "@shared/wire";
import { HomeIcon, PlugIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { ApiKeySettings } from "@/components/ApiKeySettings";
import { LayoutFooter, LayoutHeader } from "@/components/AppLayout";
import { LibrarySettings } from "@/components/LibrarySettings";
import { McpSettings } from "@/components/McpSettings";
import { PianoButton } from "@/components/PianoButton";
import { DropdownMenuItem } from "@/components/PianoDropdownMenu";
import { PianoSidebarMenuButton as SidebarMenuButton } from "@/components/PianoSidebarMenuButton";
import { PreferencesSettings } from "@/components/PreferencesSettings";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { RadiusSection } from "@/components/RadiusSection";
import { RemovalDialog, signOutCopy } from "@/components/RemovalDialog";
import { ListRow, RowMenu, RowStatus } from "@/components/RowActions";
import {
  SettingsGroup,
  SettingsList,
  SettingsLoadFailure,
  SettingsSectionFrame,
  SettingsSectionIcon,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ItemMedia } from "@/components/ui/item";
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
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/routes";
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
  const menu = (
    <nav aria-label="Settings sections">
      <SidebarMenu>
        {SETTINGS_SECTIONS.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              isActive={section === item.id}
              aria-current={section === item.id ? "page" : undefined}
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

export function SettingsPage({ section }: { section: SettingsSection }) {
  // Each page; a page named in SETTINGS_SECTIONS without one here fails to typecheck.
  const pages: Record<SettingsSection, () => React.ReactNode> = {
    providers: () => <ProvidersSettings />,
    mcp: () => <McpSettings />,
    skills: () => <LibrarySettings kind="skill" />,
    prompts: () => <LibrarySettings kind="prompt" />,
    webhooks: () => <WebhookSettings />,
    preferences: () => <PreferencesSettings />,
  };
  return pages[section]();
}

function ProvidersSettings() {
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
        <RadiusSection />
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
                  <ListRow
                    key={provider.id}
                    media={
                      logo && (
                        <ItemMedia variant="icon">
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <use href={`/provider-logos/${logo}.svg#logo`} />
                          </svg>
                        </ItemMedia>
                      )
                    }
                    title={provider.name}
                    menu={
                      action.intent === "confirm-sign-out" && (
                        <RowMenu
                          label={`${provider.name} account actions`}
                          disabled={!action.enabled}
                        >
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => actions.confirm(provider)}
                          >
                            Sign out
                          </DropdownMenuItem>
                        </RowMenu>
                      )
                    }
                    actions={
                      action.intent !== "confirm-sign-out" && (
                        <PianoButton
                          variant="outline"
                          size="sm"
                          disabled={!action.enabled}
                          aria-label={action.ariaLabel}
                          onClick={() => actions.openSignIn(provider.id)}
                        >
                          {action.label}
                        </PianoButton>
                      )
                    }
                  >
                    {provider.signedIn && <RowStatus>Signed in</RowStatus>}
                  </ListRow>
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
