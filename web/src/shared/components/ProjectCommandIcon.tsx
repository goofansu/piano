import {
  CircleCheckIcon,
  CircleMinusIcon,
  type LucideIcon,
  PlusIcon,
  RotateCcwIcon,
  SettingsIcon,
  SquarePenIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react";
import type { ProjectCommandIcon } from "../state/projectActions.ts";
const ICONS: Record<ProjectCommandIcon, LucideIcon> = {
  new: SquarePenIcon,
  create: PlusIcon,
  settings: SettingsIcon,
  done: CircleCheckIcon,
  reopen: RotateCcwIcon,
  delete: Trash2Icon,
  project: TargetIcon,
  remove: CircleMinusIcon,
};

export function isProjectCommandIcon(icon: string): icon is ProjectCommandIcon {
  return Object.hasOwn(ICONS, icon);
}

export function ProjectCommandIconView({
  icon,
  ...props
}: {
  icon: ProjectCommandIcon;
  "data-icon"?: "inline-start" | "inline-end";
}) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}
