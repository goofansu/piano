/**
 * Two routes, kept in the address bar so refresh, back and forward work:
 *   /new            the New page, with ?cwd= when a directory is prefilled
 *   /s/<sessionId>  one session; its directory is looked up in the project list
 */
export type Route = { kind: "new"; cwd?: string } | { kind: "session"; sessionId: string };

export function parseRoute(loc: { pathname: string; search: string }): Route {
  const m = loc.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (m) return { kind: "session", sessionId: decodeURIComponent(m[1]) };
  const cwd = new URLSearchParams(loc.search).get("cwd") ?? undefined;
  return { kind: "new", cwd };
}

export function routePath(r: Route): string {
  if (r.kind === "session") return `/s/${encodeURIComponent(r.sessionId)}`;
  return r.cwd ? `/new?cwd=${encodeURIComponent(r.cwd)}` : "/new";
}
