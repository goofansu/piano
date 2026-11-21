import {
  ArrowUpDownIcon,
  FolderGit2Icon,
  HomeIcon,
  LayoutListIcon,
  type LucideIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  SunIcon,
  TargetIcon,
} from "lucide-react";
import type { GlobalCommandIcon as IconId } from "@/features/commands/globalCommands";
import type { SettingsSectionIconName } from "@/features/navigation/routes";
import type { ProjectCommandIcon } from "@/features/projects/projectCommands";
import { isProjectCommandIcon, ProjectCommandIconView } from "@/features/projects/Projects";
import { SettingsSectionIcon } from "@/features/settings/SettingsSectionFrame";

const ICONS: Record<Exclude<IconId, SettingsSectionIconName | ProjectCommandIcon>, LucideIcon> = {
  home: HomeIcon,
  projects: TargetIcon,
  trusted: ShieldCheckIcon,
  untrusted: ShieldOffIcon,
  "hide-sidebar": PanelLeftCloseIcon,
  "show-sidebar": PanelLeftOpenIcon,
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
  group: LayoutListIcon,
  sort: ArrowUpDownIcon,
  "folder-git": FolderGit2Icon,
};

export function GlobalCommandIcon({
  icon,
  ...props
}: {
  icon: IconId;
  "data-icon"?: "inline-start" | "inline-end";
}) {
  if (isProjectCommandIcon(icon)) return <ProjectCommandIconView icon={icon} {...props} />;
  if (!(icon in ICONS))
    return <SettingsSectionIcon icon={icon as SettingsSectionIconName} {...props} />;
  const Icon = ICONS[icon as keyof typeof ICONS];
  return <Icon {...props} />;
}
