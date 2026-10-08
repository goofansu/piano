/**
 * Two routes, kept in the address bar so refresh, back and forward work:
 *   /new            the New page (which directory it starts in is not part of the address)
 *   /s/<sessionId>  one session; its directory is looked up in the project list
 */
export type Route = { kind: "project"; projectId: string } | { kind: "new" } | { kind: "session"; sessionId: string };

export function parseRoute(loc: { pathname: string }): Route {
  const project = loc.pathname.match(/^\/projects\/([^/]+)\/?$/);
  if (project) return { kind: "project", projectId: decodeURIComponent(project[1]) };
  const m = loc.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (m) return { kind: "session", sessionId: decodeURIComponent(m[1]) };
  return { kind: "new" };
}

export function routePath(r: Route): string {
  return r.kind === "project" ? `/projects/${encodeURIComponent(r.projectId)}` : r.kind === "session" ? `/s/${encodeURIComponent(r.sessionId)}` : "/new";
}
