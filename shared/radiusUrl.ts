const RADIUS_HOSTS = ["radius.pi.dev", "radius.earendil.com"];

export function isRadiusUrl(value: string, { query = false }: { query?: boolean } = {}): boolean {
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
    (query || !url.search) &&
    !url.hash &&
    url.pathname !== "/" &&
    RADIUS_HOSTS.includes(url.hostname)
  );
}
