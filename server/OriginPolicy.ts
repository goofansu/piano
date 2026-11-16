import { Context } from "effect";
import { isLoopbackHostname } from "../shared/loopback.ts";

export const AllowedOrigins = Context.Reference<ReadonlySet<string>>("piano/AllowedOrigins", {
  defaultValue: () => new Set(),
});

export const SessionLinkOrigin = Context.Reference<string | undefined>("piano/SessionLinkOrigin", {
  defaultValue: () => undefined,
});

export interface Listener {
  readonly host: string;
  readonly port: number;
}

export const connectableHost = (host: string): string => {
  if (host === "" || host === "0.0.0.0") return "127.0.0.1";
  if (host === "::" || host === "::0" || host === "0:0:0:0:0:0:0:0") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
};

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
  return [...origins].some((value) => {
    const origin = new URL(value);
    return (
      origin.hostname === url.hostname &&
      (origin.port === url.port ||
        (origin.port === "" && origin.protocol === "https:" && url.port === "443"))
    );
  });
}

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

export function fromOwnPage(
  headers: Readonly<Record<string, string | undefined>>,
  origins: ReadonlySet<string>,
): boolean {
  const site = headers["sec-fetch-site"];
  const origin = headers.origin;
  return (
    (site === undefined || site === "same-origin") && (origin === undefined || origins.has(origin))
  );
}
