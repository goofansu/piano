import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { type RadioChoice, radioChoiceOf } from "./commands.ts";
import { canDecideTrust, displayedTrust, pendingTrust } from "./directoryTrust.ts";
import type { Machine } from "./machine.ts";
import type { MachineOffers } from "./machineOffers.ts";
import { type EditorPage, isEditorPage, PAGE_EDITORS } from "./pageEditor.ts";
import {
  findProject,
  newProjectCommand,
  type ProjectCommand,
  type ProjectCommandIcon,
  type ProjectCommandIntent,
  type ProjectMenuCommandId,
  projectCommands,
  projectMenu,
} from "./projectCommands.ts";
import { SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionIconName } from "./routes.ts";
import { checkoutMissingAt, focusedDirectory } from "./sessionContext.ts";
import { GROUP_BY, type GroupBy, type SidebarView, SORT_BY, type SortBy } from "./sidebarView.ts";

export type Appearance = "light" | "dark" | "system";
export const APPEARANCES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const satisfies readonly { value: Appearance; label: string }[];

export type GlobalCommandId =
  | `machine-${string}`
  | "home"
  | "settings"
  | `settings-${SettingsSection}`
  | "new-session"
  | "projects"
  | "new-project"
  | (typeof PAGE_EDITORS)[EditorPage]["id"]
  | "project-settings"
  | "project-done"
  | "delete-project"
  | "trust"
  | "toggle-sidebar"
  | `appearance-${Appearance}`
  | `group-${GroupBy}`
  | `sort-${SortBy}`
  | "folder-and-branch";

export type GlobalCommandGroup =
  | "navigate"
  | "trust"
  | "sidebar"
  | "appearance"
  | "group-by"
  | "sort-by"
  | "row-details";

export type GlobalCommandIcon =
  | "machine"
  | "home"
  | "settings"
  | SettingsSectionIconName
  | "new"
  | "projects"
  | "trusted"
  | "untrusted"
  | "hide-sidebar"
  | "show-sidebar"
  | Appearance
  | "group"
  | "sort"
  | "folder-git"
  | ProjectCommandIcon;

export type GlobalCommandIntent =
  | { kind: "machine"; id: string }
  | { kind: "home" }
  | { kind: "settings"; section?: SettingsSection }
  | { kind: "new-session" }
  | { kind: "projects" }
  | ProjectCommandIntent
  | { kind: "page-editor"; page: EditorPage }
  | { kind: "send"; command: ClientCommand }
  | { kind: "toggle-sidebar" }
  | { kind: "appearance"; appearance: Appearance }
  | { kind: "view"; change: Partial<SidebarView> };

export interface GlobalCommand {
  id: GlobalCommandId;
  label: string;
  menuLabel?: string;
  icon: GlobalCommandIcon;
  group: GlobalCommandGroup;
  enabled: boolean;
  pending?: boolean;
  checked?: boolean;
  pressed?: boolean;
  keywords?: readonly string[];
  intent: GlobalCommandIntent;
}

export interface GlobalCommandContext {
  machine: Machine;
  machines: readonly Machine[];
  settings: SettingsSection | null;
  view: SidebarView;
  theme?: string;
  sidebarHidden?: boolean;
}

export function radioChoice(
  commands: readonly GlobalCommand[],
  group: "appearance" | "group-by" | "sort-by",
): RadioChoice<GlobalCommand> {
  return radioChoiceOf(commands.filter((c) => c.group === group));
}

type Offers = Pick<MachineOffers, "command">;

export function trustCommand(
  state: AppState,
  cwd: string | undefined,
  offers: Offers,
): GlobalCommand | undefined {
  if (!cwd) return undefined;
  if (checkoutMissingAt(state, cwd)) return undefined;
  const pending = !!pendingTrust(state, cwd);
  const trust = displayedTrust(state, cwd);
  if (!trust?.required) return undefined;
  const command: GlobalCommand = {
    id: "trust",
    label: trust.trusted ? "Untrust folder" : "Trust folder",
    icon: trust.trusted ? "untrusted" : "trusted",
    group: "trust",
    enabled: canDecideTrust(state, cwd),
    pending,
    pressed: trust.trusted,
    intent: { kind: "send", command: { _tag: "set_trust", path: cwd, trusted: !trust.trusted } },
  };
  return offers.command(command) ? command : undefined;
}

const PROJECT_MENU_IDS = {
  settings: "project-settings",
  done: "project-done",
  delete: "delete-project",
} as const satisfies Record<ProjectMenuCommandId, GlobalCommandId>;

export function pageCommands(
  state: AppState,
  settings: SettingsSection | null,
  offers: Offers,
): GlobalCommand[] {
  if (settings) {
    if (!isEditorPage(settings)) return [];
    const { id, label, editor } = PAGE_EDITORS[settings];
    const command: GlobalCommand = {
      id,
      label,
      icon: "create",
      group: "navigate",
      enabled: editor.available(),
      intent: { kind: "page-editor", page: settings },
    };
    return [command].filter(offers.command);
  }
  const row = (id: GlobalCommandId, c: ProjectCommand): GlobalCommand => ({
    id,
    label: c.label,
    icon: c.icon,
    group: "navigate",
    enabled: c.enabled,
    intent: c.intent,
  });
  const view = state.view;
  if (view.kind === "projects") {
    const create = newProjectCommand(state, {}, offers);
    return create ? [row("new-project", create)] : [];
  }
  const project = view.kind === "project" ? findProject(state, view.projectId) : undefined;
  if (!project) return [];
  const menu = projectMenu(projectCommands(state, project, offers));
  return [...menu.manage, ...menu.destructive].map((c) => row(PROJECT_MENU_IDS[c.id], c));
}

export function globalCommands(
  state: AppState,
  ctx: GlobalCommandContext,
  offers: Offers,
): GlobalCommand[] {
  const trust = trustCommand(state, focusedDirectory(state)?.cwd, offers);
  const theme = ctx.theme;
  const commands: GlobalCommand[] = [
    ctx.settings
      ? {
          id: "home",
          label: "Home",
          icon: "home",
          group: "navigate",
          enabled: true,
          keywords: ["back"],
          intent: { kind: "home" },
        }
      : {
          id: "settings",
          label: "Settings",
          icon: "settings",
          group: "navigate",
          enabled: true,
          intent: { kind: "settings" },
        },
    ...SETTINGS_SECTIONS.map((s): GlobalCommand => ({
      id: `settings-${s.id}`,
      label: s.label,
      icon: s.icon,
      group: "navigate",
      enabled: true,
      intent: { kind: "settings", section: s.id },
    })),
    {
      id: "new-session",
      label: "New session",
      icon: "new",
      group: "navigate",
      enabled: true,
      intent: { kind: "new-session" },
    },
    {
      id: "projects",
      label: "Projects",
      icon: "projects",
      group: "navigate",
      enabled: true,
      intent: { kind: "projects" },
    },
    ...pageCommands(state, ctx.settings, offers),
    ...(trust ? [trust] : []),
    {
      id: "toggle-sidebar",
      label: ctx.sidebarHidden ? "Show sidebar" : "Hide sidebar",
      icon: ctx.sidebarHidden ? "show-sidebar" : "hide-sidebar",
      group: "sidebar",
      enabled: true,
      intent: { kind: "toggle-sidebar" },
    },
    ...APPEARANCES.map((a): GlobalCommand => ({
      id: `appearance-${a.value}`,
      label: `${a.label} appearance`,
      menuLabel: a.label,
      icon: a.value,
      group: "appearance",
      enabled: true,
      ...(theme ? { checked: theme === a.value } : {}),
      keywords: ["theme"],
      intent: { kind: "appearance", appearance: a.value },
    })),
    ...GROUP_BY.map((g): GlobalCommand => ({
      id: `group-${g.value}`,
      label: `Group by ${g.label.toLowerCase()}`,
      menuLabel: g.label,
      icon: "group",
      group: "group-by",
      enabled: true,
      checked: ctx.view.groupBy === g.value,
      intent: { kind: "view", change: { groupBy: g.value } },
    })),
    ...SORT_BY.map((s): GlobalCommand => ({
      id: `sort-${s.value}`,
      label: `Sort by ${s.label.toLowerCase()}`,
      menuLabel: s.label,
      icon: "sort",
      group: "sort-by",
      enabled: true,
      checked: ctx.view.sortBy === s.value,
      keywords: ["order", ...(s.value === "recent" ? ["recent"] : ["alphabetical"])],
      intent: { kind: "view", change: { sortBy: s.value } },
    })),
    {
      id: "folder-and-branch",
      label: ctx.view.folderAndBranch ? "Hide folder and branch" : "Show folder and branch",
      menuLabel: "Folder and branch",
      icon: "folder-git",
      group: "row-details",
      enabled: true,
      pressed: ctx.view.folderAndBranch,
      intent: { kind: "view", change: { folderAndBranch: !ctx.view.folderAndBranch } },
    },
    ...(ctx.machines.length > 1 ? ctx.machines : []).map((machine): GlobalCommand => ({
      id: `machine-${machine.id}`,
      label: `Switch to ${machine.name}`,
      icon: "machine",
      group: "navigate",
      enabled: machine.id !== ctx.machine.id,
      checked: machine.id === ctx.machine.id,
      intent: { kind: "machine", id: machine.id },
    })),
  ];
  return commands.filter(offers.command);
}
