const RADIUS_HOSTS = ["radius.pi.dev", "radius.earendil.com"];
export const RADIUS_MCP_URL = "https://radius.pi.dev/mcp";

export function isRadiusUrl(value: string, purpose: "view" | "download" = "view"): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    (purpose === "download" || (!url.search && !url.hash && url.pathname !== "/")) &&
    RADIUS_HOSTS.includes(url.hostname)
  );
}
