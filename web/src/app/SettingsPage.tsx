import { DataControlsSettings } from "@features/data-controls/web/DataControlsSettings";
import { LibrarySettings } from "@features/library/web/LibrarySettings";
import { McpSettings } from "@features/mcp/web/McpSettings";
import { LayoutFooter, LayoutHeader } from "@features/navigation/web/AppLayout";
import { providerLogin } from "@features/providers/web/providerApi";
import { ProvidersSettings } from "@features/providers/web/ProvidersSettings";
import { providerAccounts } from "@features/providers/web/useProviderAccounts";
import { RadiusSection } from "@features/radius/web/RadiusSection";
import { SettingsMenu } from "@features/settings/web/SettingsMenu";
import { PreferencesSettings } from "@features/voice-input/web/PreferencesSettings";
import { WebhookSettings } from "@features/webhooks/web/WebhookSettings";
import { HomeIcon } from "lucide-react";
import { PageHeaderActions } from "@/app/commands/PageHeaderActions";
import { SidebarContent, SidebarGroup, SidebarGroupContent } from "@/components/ui/sidebar";
import { PianoButton } from "@/shared/components/PianoButton";
import type { SettingsSection } from "@/shared/navigation/routes";
import type { Client } from "@/shared/state/client";
import type { AppState } from "@/shared/state/state";
import { PAGE_EDITORS } from "./settingsEditors";

export type { SettingsSection } from "@/shared/navigation/routes";

export function SettingsNavigation({
  section,
  onSelect,
  onHome,
}: {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  onHome: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <LayoutHeader />
      <SidebarContent>
        <SidebarGroup className="px-(--row-inset)">
          <SidebarGroupContent>
            <SettingsMenu section={section} onSelect={onSelect} />
          </SidebarGroupContent>
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
  state,
  client,
}: {
  section: SettingsSection;
  state: AppState;
  client: Client;
}) {
  const headerActions = <PageHeaderActions page="settings" />;
  const pages: Record<SettingsSection, () => React.ReactNode> = {
    providers: () => (
      <ProvidersSettings>
        <RadiusSection accounts={providerAccounts} signIn={providerLogin} />
      </ProvidersSettings>
    ),
    mcp: () => <McpSettings editor={PAGE_EDITORS.mcp} headerActions={headerActions} />,
    skills: () => (
      <LibrarySettings kind="skill" editor={PAGE_EDITORS.skills} headerActions={headerActions} />
    ),
    prompts: () => (
      <LibrarySettings kind="prompt" editor={PAGE_EDITORS.prompts} headerActions={headerActions} />
    ),
    webhooks: () => (
      <WebhookSettings editor={PAGE_EDITORS.webhooks} headerActions={headerActions} />
    ),
    preferences: () => <PreferencesSettings />,
    "data-controls": () => <DataControlsSettings state={state} client={client} />,
  };
  return pages[section]();
}
