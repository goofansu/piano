/**
 * The commands that apply wherever the user is, described once: navigation, what the open page's
 * header offers (`pageCommands`), directory trust, the sidebar and its view, and appearance. The
 * command palette's Global commands group, the sidebar's View menu, the Projects index's and
 * Webhooks page's headers and the New session page's trust toggle render these instead of each
 * deciding.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { type RadioChoice, radioChoiceOf } from "./commands.ts";
import { canDecideTrust, displayedTrust, pendingTrust } from "./directoryTrust.ts";
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
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionIconName,
  settingsPage,
} from "./routes.ts";
import { checkoutMissingAt, focusedDirectory } from "./sessionContext.ts";
import { GROUP_BY, type GroupBy, type SidebarView, SORT_BY, type SortBy } from "./sidebarView.ts";

export type Appearance = "light" | "dark" | "system";
/** The appearance choices, in menu order; the palette and the View menu both list these. */
export const APPEARANCES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const satisfies readonly { value: Appearance; label: string }[];

export type GlobalCommandId =
  | "home"
  | "settings"
  | `settings-${SettingsSection}`
  | "new-session"
  | "projects"
  | "new-project"
  | "add-webhook"
  | "new-skill"
  | "project-settings"
  | "delete-project"
  | "trust"
  | "toggle-sidebar"
  | `appearance-${Appearance}`
  | `group-${GroupBy}`
  | `sort-${SortBy}`
  | "folder-and-branch";

/** Sections a menu separates; the palette lists them in this order under Global commands. */
export type GlobalCommandGroup =
  | "navigate"
  | "trust"
  | "sidebar"
  | "appearance"
  | "group-by"
  | "sort-by"
  | "row-details";

export type GlobalCommandIcon =
  | "home"
  | "settings"
  | SettingsSectionIconName
  | "new"
  | "projects"
  | "trusted"
  | "untrusted"
  | "sidebar"
  | Appearance
  | "group"
  | "sort"
  | "folder-git"
  | ProjectCommandIcon;

export type GlobalCommandIntent =
  | { kind: "home" }
  /** Open Settings, at `section` when given. */
  | { kind: "settings"; section?: SettingsSection }
  /** Open the New session page. */
  | { kind: "new-session" }
  /** Open the Projects index. */
  | { kind: "projects" }
  /** The open page's header action (New project, a project's menu row), as the page runs it. */
  | ProjectCommandIntent
  /** Open the webhook editor on a new webhook, as the Webhooks page's header does. */
  | { kind: "add-webhook" }
  /** Open the skill editor on a new skill, as the Skills page's header does. */
  | { kind: "new-skill" }
  /** Send this registry or Pi change. */
  | { kind: "send"; command: ClientCommand }
  | { kind: "toggle-sidebar" }
  | { kind: "appearance"; appearance: Appearance }
  | { kind: "view"; change: Partial<SidebarView> };

export interface GlobalCommand {
  id: GlobalCommandId;
  /** The palette row's name. */
  label: string;
  /** The name of a choice inside the View menu's submenu, where the submenu already says what it chooses. */
  menuLabel?: string;
  icon: GlobalCommandIcon;
  group: GlobalCommandGroup;
  enabled: boolean;
  /** The command is awaiting its server decision. */
  pending?: boolean;
  /** The current choice of its group. */
  checked?: boolean;
  /** A toggle that is on: the directory is trusted. Its label already names what running it does. */
  pressed?: boolean;
  /** Direct synonyms of the label, for palette search; not topics or what the command touches. */
  keywords?: readonly string[];
  intent: GlobalCommandIntent;
}

export interface GlobalCommandContext {
  /**
   * The open Settings section, or `null` when none is: the palette then offers the way back instead
   * of Settings, and that page's header actions instead of the page beneath it.
   */
  settings: SettingsSection | null;
  view: SidebarView;
  /** The chosen appearance, for a surface that marks it; without it no appearance is checked. */
  theme?: string;
}

/** One of the View menu's choices (appearance, grouping or sorting) as a radio group. */
export function radioChoice(
  commands: readonly GlobalCommand[],
  group: "appearance" | "group-by" | "sort-by",
): RadioChoice<GlobalCommand> {
  return radioChoiceOf(commands.filter((c) => c.group === group));
}

/**
 * Trust or untrust `cwd`, when Pi says the directory has resources it loads only when trusted.
 * There is no command without that requirement, nor for the selected session's missing checkout,
 * which Pi cannot be asked about. It changes Pi's settings, so it waits for a connection.
 */
export function trustCommand(state: AppState, cwd: string | undefined): GlobalCommand | undefined {
  if (!cwd) return undefined;
  if (checkoutMissingAt(state, cwd)) return undefined;
  const pending = !!pendingTrust(state, cwd);
  const trust = displayedTrust(state, cwd);
  if (!trust?.required) return undefined;
  return {
    id: "trust",
    label: trust.trusted ? "Untrust folder" : "Trust folder",
    icon: trust.trusted ? "untrusted" : "trusted",
    group: "trust",
    enabled: canDecideTrust(state, cwd),
    pending,
    pressed: trust.trusted,
    intent: { kind: "send", command: { _tag: "set_trust", path: cwd, trusted: !trust.trusted } },
  };
}

/** Each row a project's menu lists, by its palette ID; a row the menu adds fails here until named. */
const PROJECT_MENU_IDS = {
  settings: "project-settings",
  delete: "delete-project",
} as const satisfies Record<ProjectMenuCommandId, GlobalCommandId>;

/**
 * What the open page offers in its header, as the page's own commands describe it: on Settings ›
 * Webhooks, Add webhook; on Settings › Skills, New skill; on the Projects index, New project; on a project's home, its menu
 * (`projectMenu`), manage rows then destructive (the home itself starts sessions). An open Settings
 * page covers the page beneath it, so only its own actions count. The palette lists exactly these,
 * so a page or menu that adds a header action gets its row, named as its button is, by construction.
 */
export function pageCommands(
  state: AppState,
  settings: SettingsSection | null = null,
): GlobalCommand[] {
  if (settings) {
    const page = settingsPage(settings);
    if (page === "webhooks")
      return [
        {
          id: "add-webhook",
          label: "Add webhook",
          icon: "new",
          group: "navigate",
          enabled: true,
          intent: { kind: "add-webhook" },
        },
      ];
    if (page === "skills")
      return [
        {
          id: "new-skill",
          label: "New skill",
          icon: "new",
          group: "navigate",
          enabled: true,
          intent: { kind: "new-skill" },
        },
      ];
    return [];
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
  if (view.kind === "projects") return [row("new-project", newProjectCommand(state))];
  const project = view.kind === "project" ? findProject(state, view.projectId) : undefined;
  if (!project) return [];
  const menu = projectMenu(projectCommands(state, project));
  return [...menu.manage, ...menu.destructive].map((c) => row(PROJECT_MENU_IDS[c.id], c));
}

/**
 * Global commands, in the palette's order: Home or Settings (whichever is not open), each Settings
 * section, New session, Projects, the open page's header actions (`pageCommands`), trust for the
 * directory the main pane is about, Toggle sidebar, the appearances, then each sidebar grouping and sort, with the current one of each checked.
 */
export function globalCommands(state: AppState, ctx: GlobalCommandContext): GlobalCommand[] {
  const trust = trustCommand(state, focusedDirectory(state)?.cwd);
  const theme = ctx.theme;
  return [
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
    ...SETTINGS_SECTIONS.map(
      (s): GlobalCommand => ({
        id: `settings-${s.id}`,
        label: s.label,
        icon: s.icon,
        group: "navigate",
        enabled: true,
        intent: { kind: "settings", section: s.id },
      }),
    ),
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
    ...pageCommands(state, ctx.settings),
    ...(trust ? [trust] : []),
    {
      id: "toggle-sidebar",
      label: "Toggle sidebar",
      icon: "sidebar",
      group: "sidebar",
      enabled: true,
      intent: { kind: "toggle-sidebar" },
    },
    ...APPEARANCES.map(
      (a): GlobalCommand => ({
        id: `appearance-${a.value}`,
        label: `${a.label} appearance`,
        menuLabel: a.label,
        icon: a.value,
        group: "appearance",
        enabled: true,
        ...(theme ? { checked: theme === a.value } : {}),
        keywords: ["theme"],
        intent: { kind: "appearance", appearance: a.value },
      }),
    ),
    ...GROUP_BY.map(
      (g): GlobalCommand => ({
        id: `group-${g.value}`,
        label: g.value === "none" ? "No grouping" : `Group by ${g.label.toLowerCase()}`,
        menuLabel: g.label,
        icon: "group",
        group: "group-by",
        enabled: true,
        checked: ctx.view.groupBy === g.value,
        intent: { kind: "view", change: { groupBy: g.value } },
      }),
    ),
    ...SORT_BY.map(
      (s): GlobalCommand => ({
        id: `sort-${s.value}`,
        label: `Sort by ${s.label.toLowerCase()}`,
        menuLabel: s.label,
        icon: "sort",
        group: "sort-by",
        enabled: true,
        checked: ctx.view.sortBy === s.value,
        keywords: ["order", ...(s.value === "recent" ? ["recent"] : ["alphabetical"])],
        intent: { kind: "view", change: { sortBy: s.value } },
      }),
    ),
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
  ];
}
