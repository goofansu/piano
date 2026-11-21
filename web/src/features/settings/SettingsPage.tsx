import { HomeIcon } from "lucide-react";
import type { Client } from "@/app/client";
import type { AppState } from "@/app/store";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { DataControlsSettings } from "@/features/data-controls/DataControlsSettings";
import { LibrarySettings } from "@/features/library/LibrarySettings";
import { McpSettings } from "@/features/mcp/McpSettings";
import { LayoutFooter, LayoutHeader } from "@/features/navigation/AppLayout";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/features/navigation/routes";
import { PianoSidebarMenuButton as SidebarMenuButton } from "@/features/navigation/sidebar/PianoSidebarMenuButton";
import { ProvidersSettings } from "@/features/providers/ProvidersSettings";
import { RadiusSection } from "@/features/radius/RadiusSection";
import { SettingsSectionIcon } from "@/features/settings/SettingsSectionFrame";
import { PreferencesSettings } from "@/features/voice-input/PreferencesSettings";
import { WebhookSettings } from "@/features/webhooks/WebhookSettings";
import { PianoButton } from "@/shared/components/PianoButton";

export type { SettingsSection } from "@/features/navigation/routes";

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
  state,
  client,
}: {
  section: SettingsSection;
  state: AppState;
  client: Client;
}) {
  const pages: Record<SettingsSection, () => React.ReactNode> = {
    providers: () => (
      <ProvidersSettings>
        <RadiusSection />
      </ProvidersSettings>
    ),
    mcp: () => <McpSettings />,
    skills: () => <LibrarySettings kind="skill" />,
    prompts: () => <LibrarySettings kind="prompt" />,
    webhooks: () => <WebhookSettings />,
    preferences: () => <PreferencesSettings />,
    "data-controls": () => <DataControlsSettings state={state} client={client} />,
  };
  return pages[section]();
}
