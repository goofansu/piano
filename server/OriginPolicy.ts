import { Context } from "effect";

/** INV-11: explicit deployment configuration, never derived from request/proxy headers. */
export const AllowedOrigins = Context.Reference<ReadonlySet<string>>("piano/AllowedOrigins", {
  defaultValue: () => new Set(),
});

/** Unset means local built UI only. An explicit list replaces (not extends) the defaults. */
export function configuredOrigins(port: number, configured?: string): ReadonlySet<string> {
  const entries =
    configured === undefined
      ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]
      : configured.split(",").map((value) => value.trim());
  return new Set(
    entries.map((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error("PIANO_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins.");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.hostname.includes("*") ||
        url.origin !== value
      ) {
        throw new Error(
          "PIANO_ALLOWED_ORIGINS requires exact HTTP(S) origins without paths, credentials, or wildcards.",
        );
      }
      return url.origin;
    }),
  );
}

/**
 * The session link origin (docs/configuration.md): the base of every `/s/<sessionId>` link Piano
 * hands out for dispatched sessions. Chosen from the configured
 * set, never from a request (INV-11). The first HTTPS origin wins, since a link has to open from a
 * remote browser; otherwise the origin naming `listener` (`host:port`); otherwise the first
 * configured, which in development is the Vite origin. While an HTTPS origin is configured the
 * answer does not depend on `listener`, so a caller that does not know it agrees with one that
 * does.
 */
export function sessionLinkOrigin(
  origins: ReadonlySet<string>,
  listener?: string,
): string | undefined {
  const allowed = [...origins];
  return (
    allowed.find((value) => value.startsWith("https://")) ??
    allowed.find((value) => new URL(value).host === listener) ??
    allowed[0]
  );
}
