/**
 * Routes, kept in the address bar so refresh, back and forward work:
 *   /new             the New page (which directory it starts in is not part of the address)
 *   /projects/<id>   the New page for one project: a session started there joins it
 *   /s/<sessionId>   one session; its directory is looked up in the folder list
 *   /settings/<section> one settings page; /settings aliases the first section, Providers
 */

/**
 * The Settings sections, in navigation order. Settings navigation, the route parser and the
 * command palette's rows all read this list, so a section is added here once.
 */
export const SETTINGS_SECTIONS = [
  { id: "providers", label: "Providers", icon: "plug", keywords: ["settings", "oauth", "sign in"] },
  { id: "radius", label: "Radius", icon: "radius", keywords: ["settings", "setup", "oauth", "mcp", "web search"] },
  { id: "mcp", label: "MCP", icon: "server", keywords: ["settings", "servers", "tools", "linear", "install", "sign in"] },
] as const satisfies readonly { id: string; label: string; icon: string; keywords: readonly string[] }[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
export type SettingsSectionIconName = (typeof SETTINGS_SECTIONS)[number]["icon"];
export type Route = { kind: "new"; projectId?: string } | { kind: "session"; sessionId: string } | { kind: "settings"; section: SettingsSection };

const settingsSection = (id: string | undefined): SettingsSection | undefined =>
  id === undefined ? SETTINGS_SECTIONS[0].id : SETTINGS_SECTIONS.find(section => section.id === id)?.id;

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
