import {
  ArrowUpDownIcon,
  HomeIcon,
  LayoutListIcon,
  type LucideIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  SunIcon,
} from "lucide-react";
import { SettingsSectionIcon } from "@/components/SettingsSectionFrame";
import type { GlobalCommandIcon as IconId } from "@/lib/globalCommands";
import type { SettingsSectionIconName } from "@/lib/routes";

const ICONS: Record<Exclude<IconId, SettingsSectionIconName>, LucideIcon> = {
  home: HomeIcon,
  settings: SettingsIcon,
  new: PlusIcon,
  instructions: ScrollTextIcon,
  trusted: ShieldCheckIcon,
  untrusted: ShieldOffIcon,
  sidebar: PanelLeftIcon,
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
  group: LayoutListIcon,
  sort: ArrowUpDownIcon,
};

/** A global command's icon, as the palette, the View menu and the trust toggle show it; Settings sections keep their own. */
export function GlobalCommandIcon({ icon }: { icon: IconId }) {
  if (!(icon in ICONS)) return <SettingsSectionIcon icon={icon as SettingsSectionIconName} />;
  const Icon = ICONS[icon as keyof typeof ICONS];
  return <Icon />;
}
