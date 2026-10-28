import {
  ArrowUpDownIcon,
  FolderGit2Icon,
  HomeIcon,
  LayoutListIcon,
  type LucideIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  SunIcon,
  TargetIcon,
} from "lucide-react";
import { isProjectCommandIcon, ProjectCommandIconView } from "@/components/Projects";
import { SettingsSectionIcon } from "@/components/SettingsSectionFrame";
import type { GlobalCommandIcon as IconId } from "@/lib/globalCommands";
import type { ProjectCommandIcon } from "@/lib/projectCommands";
import type { SettingsSectionIconName } from "@/lib/routes";

/** The global names only: Settings sections and project commands keep their own maps. */
const ICONS: Record<Exclude<IconId, SettingsSectionIconName | ProjectCommandIcon>, LucideIcon> = {
  home: HomeIcon,
  projects: TargetIcon,
  trusted: ShieldCheckIcon,
  untrusted: ShieldOffIcon,
  sidebar: PanelLeftIcon,
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
  group: LayoutListIcon,
  sort: ArrowUpDownIcon,
  "folder-git": FolderGit2Icon,
};

/**
 * A global command's icon, as the palette, the View menu, the trust toggle and a page header's
 * button show it. A project command's icon name draws from the project map (so do Settings and
 * New session, which share the names `settings` and `new`); a Settings section's from its own.
 */
export function GlobalCommandIcon({
  icon,
  ...props
}: {
  icon: IconId;
  /** A Button's leading or trailing icon, which sets its padding. */
  "data-icon"?: "inline-start" | "inline-end";
}) {
  if (isProjectCommandIcon(icon)) return <ProjectCommandIconView icon={icon} {...props} />;
  if (!(icon in ICONS))
    return <SettingsSectionIcon icon={icon as SettingsSectionIconName} {...props} />;
  const Icon = ICONS[icon as keyof typeof ICONS];
  return <Icon {...props} />;
}
