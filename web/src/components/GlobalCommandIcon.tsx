import {
  ArrowUpDownIcon,
  HomeIcon,
  LayoutListIcon,
  type LucideIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  SunIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react";
import { SettingsSectionIcon } from "@/components/SettingsSectionFrame";
import type { GlobalCommandIcon as IconId } from "@/lib/globalCommands";
import type { SettingsSectionIconName } from "@/lib/routes";

const ICONS: Record<Exclude<IconId, SettingsSectionIconName>, LucideIcon> = {
  home: HomeIcon,
  settings: SettingsIcon,
  new: PlusIcon,
  projects: TargetIcon,
  trusted: ShieldCheckIcon,
  untrusted: ShieldOffIcon,
  sidebar: PanelLeftIcon,
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
  group: LayoutListIcon,
  sort: ArrowUpDownIcon,
  delete: Trash2Icon,
};

/**
 * A global command's icon, as the palette, the View menu, the trust toggle and a page header's
 * button show it; Settings sections keep their own.
 */
export function GlobalCommandIcon({
  icon,
  ...props
}: {
  icon: IconId;
  /** A Button's leading or trailing icon, which sets its padding. */
  "data-icon"?: "inline-start" | "inline-end";
}) {
  if (!(icon in ICONS))
    return <SettingsSectionIcon icon={icon as SettingsSectionIconName} {...props} />;
  const Icon = ICONS[icon as keyof typeof ICONS];
  return <Icon {...props} />;
}
