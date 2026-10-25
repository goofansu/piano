import { Context } from "effect";
import { isLoopbackHostname } from "../shared/loopback.ts";

/** INV-11: explicit deployment configuration, never derived from request/proxy headers. */
export const AllowedOrigins = Context.Reference<ReadonlySet<string>>("piano/AllowedOrigins", {
  defaultValue: () => new Set(),
});

/** The `sessionLinkOrigin` `main` decides at startup; unset, Piano hands out no `/s/<id>` link. */
export const SessionLinkOrigin = Context.Reference<string | undefined>("piano/SessionLinkOrigin", {
  defaultValue: () => undefined,
});

/** The address and port Piano listens on, as `HOST` and `PORT` give them. */
export interface Listener {
  readonly host: string;
  readonly port: number;
}

/** Wildcard bind addresses are not connectable, and a bare IPv6 literal needs brackets in a URL. */
export const connectableHost = (host: string): string => {
  if (host === "" || host === "0.0.0.0") return "127.0.0.1";
  if (host === "::" || host === "::0" || host === "0:0:0:0:0:0:0:0") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
};

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
 * Whether a request's `Host` header names this server. A browser that DNS rebinding sent to Piano
 * still carries the attacker's hostname, so only the hosts of the allowed origins and the loopback
 * names pass (the loopback interface is how the proxy and Pi's session extension connect). The
 * allowed origins decide, never a forwarded header (INV-11).
 */
export function hostAllowed(origins: ReadonlySet<string>, host: string | undefined): boolean {
  if (!host) return false;
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
  if (isLoopbackHostname(url.hostname)) return true;
  // Compare parsed, so case, IDN spelling and an explicit default port (`:80`, `:443`) still match.
  return [...origins].some((value) => {
    const origin = new URL(value);
    return (
      origin.hostname === url.hostname &&
      (origin.port === url.port ||
        (origin.port === "" && origin.protocol === "https:" && url.port === "443"))
    );
  });
}

/**
 * The session link origin (docs/configuration.md): the base of every `/s/<sessionId>` link Piano
 * hands out for dispatched sessions. Chosen from the configured
 * set, never from a request (INV-11). The first HTTPS origin wins, since a link has to open from a
 * remote browser; otherwise the origin naming `listener` (`host:port`); otherwise the first
 * configured, which in development is the Vite origin.
 */
export function sessionLinkOrigin(
  origins: ReadonlySet<string>,
  listener: Listener,
): string | undefined {
  const allowed = [...origins];
  const authority = `${connectableHost(listener.host)}:${listener.port}`;
  return (
    allowed.find((value) => value.startsWith("https://")) ??
    allowed.find((value) => new URL(value).host === authority) ??
    allowed[0]
  );
}
