import type { GlobalCommandIcon as IconId } from "@features/commands/web/globalCommands";
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
import {
  isProjectCommandIcon,
  ProjectCommandIconView,
} from "@/shared/components/ProjectCommandIcon";
import { SettingsSectionIcon } from "@/shared/components/SettingsSectionFrame";
import type { SettingsSectionIconName } from "@/shared/navigation/routes";
import type { ProjectCommandIcon } from "@/shared/state/projectActions";

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
