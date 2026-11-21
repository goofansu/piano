import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { SettingsSectionIcon } from "@/shared/components/SettingsSectionFrame";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/shared/navigation/routes";
import { PianoSidebarMenuButton as SidebarMenuButton } from "./SettingsMenuButton";

export function SettingsMenu({
  section,
  onSelect,
}: {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
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
}
