/**
 * Routes, kept in the address bar so refresh, back and forward work:
 *   /new             the New page (which directory it starts in is not part of the address)
 *   /projects        the Projects index: every project, newest activity first
 *   /projects/<id>   one project's home: its branches and other member sessions
 *   /projects/<id>/new the New page for one project: a session started there joins it
 *   /s/<sessionId>   one session; its directory is looked up in the folder list
 *   /settings/<section> one settings page; /settings aliases the first section, Providers
 */

/**
 * The Settings pages, shared by the route parser, navigation and command palette.
 * A destination carries no search words: the palette already matches the label the user reads.
 */
export const SETTINGS_SECTIONS = [
  { id: "providers", label: "Providers", icon: "plug" },
  { id: "mcp", label: "MCP", icon: "server" },
  { id: "skills", label: "Skills", icon: "skill" },
  { id: "prompts", label: "Prompts", icon: "prompt" },
  { id: "webhooks", label: "Webhooks", icon: "webhook" },
  { id: "preferences", label: "Preferences", icon: "preferences" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: string;
}[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
export type SettingsSectionIconName = (typeof SETTINGS_SECTIONS)[number]["icon"];

export type Route =
  | { kind: "new"; projectId?: string }
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
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
  if (/^\/projects\/?$/.test(loc.pathname)) return { kind: "projects" };
  const project = loc.pathname.match(/^\/projects\/([^/]+)(\/new)?\/?$/);
  if (project)
    return project[2]
      ? { kind: "new", projectId: decodeURIComponent(project[1]) }
      : { kind: "project", projectId: decodeURIComponent(project[1]) };
  const m = loc.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (m) return { kind: "session", sessionId: decodeURIComponent(m[1]) };
  return { kind: "new" };
}

export function routePath(r: Route): string {
  if (r.kind === "settings") return `/settings/${r.section}`;
  if (r.kind === "session") return `/s/${encodeURIComponent(r.sessionId)}`;
  if (r.kind === "projects") return "/projects";
  if (r.kind === "project") return `/projects/${encodeURIComponent(r.projectId)}`;
  return r.projectId ? `/projects/${encodeURIComponent(r.projectId)}/new` : "/new";
}
