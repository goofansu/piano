/**
 * Routes, kept in the address bar so refresh, back and forward work:
 *   /new             the New page (which directory it starts in is not part of the address)
 *   /projects/<id>   the New page for one project: a session started there joins it
 *   /s/<sessionId>   one session; its directory is looked up in the folder list
 *   /settings/<section> one settings page; /settings aliases Providers
 */
export type SettingsSection = "providers" | "radius" | "mcp";
export type Route = { kind: "new"; projectId?: string } | { kind: "session"; sessionId: string } | { kind: "settings"; section: SettingsSection };

export function parseRoute(loc: { pathname: string }): Route {
  const settings = loc.pathname.match(/^\/settings(?:\/(providers|radius|mcp))?\/?$/);
  if (settings) return { kind: "settings", section: (settings[1] as SettingsSection) ?? "providers" };
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
