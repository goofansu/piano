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
