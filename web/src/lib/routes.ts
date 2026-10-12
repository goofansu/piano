/**
 * Routes, kept in the address bar so refresh, back and forward work:
 *   /new             the New page (which directory it starts in is not part of the address)
 *   /projects/<id>   the New page for one project: a session started there joins it
 *   /s/<sessionId>   one session; its directory is looked up in the folder list
 *   /settings/<section> one settings page; /settings aliases the first section, Providers,
 *                      and /settings/radius opens Providers with its Radius section revealed
 */

/**
 * The Settings destinations, in the order the command palette offers them. Each one addresses a
 * page; Radius is a section of the Providers page rather than a page of its own, so `/settings/radius`
 * and its palette row open Providers with the Radius section revealed. A destination is added here once:
 * Settings navigation, the route parser and the palette's rows all read this list.
 */
export const SETTINGS_SECTIONS = [
  {
    id: "providers",
    label: "Providers",
    icon: "plug",
    page: "providers",
    keywords: ["settings", "oauth", "sign in"],
  },
  {
    id: "radius",
    label: "Radius",
    icon: "radius",
    page: "providers",
    keywords: ["settings", "setup", "oauth", "mcp", "web search", "providers"],
  },
  {
    id: "mcp",
    label: "MCP",
    icon: "server",
    page: "mcp",
    keywords: ["settings", "servers", "tools", "linear", "install", "sign in"],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: string;
  page: string;
  keywords: readonly string[];
}[];

/** Settings navigation lists one row per page, so Radius appears only inside Providers. */
export const SETTINGS_PAGES = SETTINGS_SECTIONS.filter((section) => section.id === section.page);

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
export type SettingsPage = (typeof SETTINGS_SECTIONS)[number]["page"];
export type SettingsSectionIconName = (typeof SETTINGS_SECTIONS)[number]["icon"];

/** The page a section shows; Radius shows Providers with its own section revealed. */
export const settingsPage = (section: SettingsSection): SettingsPage =>
  section === "radius" ? "providers" : section;

export type Route =
  | { kind: "new"; projectId?: string }
  | { kind: "session"; sessionId: string }
  | { kind: "settings"; section: SettingsSection };

const settingsSection = (id: string | undefined): SettingsSection | undefined =>
  id === undefined
    ? SETTINGS_SECTIONS[0].id
    : SETTINGS_SECTIONS.find((section) => section.id === id)?.id;

export function parseRoute(loc: { pathname: string }): Route {
  const settings = loc.pathname.match(/^\/settings(?:\/([^/]+))?\/?$/);
  const section = settings && settingsSection(settings[1]);
  if (section) return { kind: "settings", section };
  const project = loc.pathname.match(/^\/projects\/([^/]+)\/?$/);
  if (project) return { kind: "new", projectId: decodeURIComponent(project[1]) };
  const m = loc.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (m) return { kind: "session", sessionId: decodeURIComponent(m[1]) };
  return { kind: "new" };
}

export function routePath(r: Route): string {
  if (r.kind === "settings") return `/settings/${r.section}`;
  if (r.kind === "session") return `/s/${encodeURIComponent(r.sessionId)}`;
  return r.projectId ? `/projects/${encodeURIComponent(r.projectId)}` : "/new";
}
