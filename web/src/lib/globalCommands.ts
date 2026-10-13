/**
 * The commands that apply wherever the user is, described once: navigation, directory trust, the
 * sidebar and its view, and appearance. The command palette's Global commands group, the sidebar's
 * View menu and the New session page's trust toggle render these instead of each deciding.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { type RadioChoice, radioChoiceOf } from "./commands.ts";
import { SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionIconName } from "./routes.ts";
import { directoryTrust, focusedDirectory } from "./sessionContext.ts";
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
  | "trust"
  | "toggle-sidebar"
  | `appearance-${Appearance}`
  | `group-${GroupBy}`
  | `sort-${SortBy}`;

/** Sections a menu separates; the palette lists them in this order under Global commands. */
export type GlobalCommandGroup =
  | "navigate"
  | "trust"
  | "sidebar"
  | "appearance"
  | "group-by"
  | "sort-by";

export type GlobalCommandIcon =
  | "home"
  | "settings"
  | SettingsSectionIconName
  | "new"
  | "trusted"
  | "untrusted"
  | "sidebar"
  | Appearance
  | "group"
  | "sort";

export type GlobalCommandIntent =
  | { kind: "home" }
  /** Open Settings, at `section` when given. */
  | { kind: "settings"; section?: SettingsSection }
  | { kind: "new-session" }
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
  /** The current choice of its group. */
  checked?: boolean;
  /** A toggle that is on: the directory is trusted. Its label already names what running it does. */
  pressed?: boolean;
  /** Extra palette search words. */
  keywords?: readonly string[];
  intent: GlobalCommandIntent;
}

export interface GlobalCommandContext {
  /** A Settings page is open, so the palette offers the way back instead of Settings. */
  settingsOpen: boolean;
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
  if (state.session?.cwd === cwd && state.session.state.checkoutMissing) return undefined;
  const trust = directoryTrust(state, cwd);
  if (!trust?.required) return undefined;
  return {
    id: "trust",
    label: trust.trusted ? "Untrust folder" : "Trust folder",
    icon: trust.trusted ? "untrusted" : "trusted",
    group: "trust",
    enabled: state.connected,
    pressed: trust.trusted,
    keywords: ["trust", "pi settings", "skills"],
    intent: { kind: "send", command: { _tag: "set_trust", path: cwd, trusted: !trust.trusted } },
  };
}

/**
 * Global commands, in the palette's order: Home or Settings (whichever is not open), each Settings
 * section, New session, trust for the directory the main pane is about, Toggle sidebar, the
 * appearances, then each sidebar grouping and sort, with the current one of each checked.
 */
export function globalCommands(state: AppState, ctx: GlobalCommandContext): GlobalCommand[] {
  const trust = trustCommand(state, focusedDirectory(state)?.cwd);
  const theme = ctx.theme;
  return [
    ctx.settingsOpen
      ? {
          id: "home",
          label: "Home",
          icon: "home",
          group: "navigate",
          enabled: true,
          keywords: ["back", "session"],
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
        keywords: s.keywords,
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
        keywords: ["appearance", "theme"],
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
        keywords: ["group", "sidebar", "view"],
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
        keywords: ["sort", "order", "sidebar", "view"],
        intent: { kind: "view", change: { sortBy: s.value } },
      }),
    ),
  ];
}
