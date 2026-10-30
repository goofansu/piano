/**
 * Internal to PiHistory and its worker: what makes a saved Pi history file the one a caller asked
 * for. Free of Effect and the job queue, so the worker can import it.
 */
import type { BigIntStats } from "node:fs";
import { parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent";

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
