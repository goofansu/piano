/**
 * Internal to PiHistory and its worker: what makes a saved Pi history file the one a caller asked
 * for. Free of Effect and the job queue, so the worker can import it.
 */
import type { BigIntStats } from "node:fs";

// Pi 1.5.2's public root re-exports these exact implementations, but also initializes the
// interactive/runtime graph in every read-only worker. No public history subpath exists yet.
// Keep this version-dependent path here; recheck it on Pi upgrades (INV-01/12).
const loadHistorySdk = async () => {
  const url = new URL(
    "./core/session-manager.js",
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  try {
    const sdk = (await import(url.href)) as Pick<
      typeof import("@earendil-works/pi-coding-agent"),
      "parseSessionEntries" | "SessionManager"
    >;
    if (
      typeof sdk.parseSessionEntries === "function" &&
      typeof sdk.SessionManager?.inMemory === "function"
    )
      return sdk;
  } catch (cause) {
    // Only a missing entry point is a compatibility fallback. A broken dependency or module
    // initialization must still fail, as must parsing/migration/projection below.
    if (
      !(cause instanceof Error) ||
      !("code" in cause) ||
      cause.code !== "ERR_MODULE_NOT_FOUND" ||
      !("url" in cause) ||
      cause.url !== url.href
    )
      throw cause;
  }
  return import("@earendil-works/pi-coding-agent");
};

const { parseSessionEntries, SessionManager } = await loadHistorySdk();

/**
 * The saved session, if this file's content is session `sessionId`. Pi parses and migrates only in
 * memory: a persistent manager can rewrite legacy/empty files.
 */
export const savedSession = (content: string, sessionId: string) => {
  const entries = parseSessionEntries(content);
  if (!entries.some((entry) => entry.type === "session" && entry.id === sessionId))
    throw new Error("Missing session header");
  return SessionManager.inMemory(undefined, undefined, entries);
};

/**
 * A file's version: any rewrite, replacement or move onto its path changes it. ctime detects
 * same-size rewrites with restored mtime, but even nanosecond stat fields can share a filesystem
 * clock tick, so a caller caching by version must wait until that tick is safely past.
 */
export const fileVersion = (info: BigIntStats) =>
  [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(":");
