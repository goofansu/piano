import type { BigIntStats } from "node:fs";

const loadHistorySdk = async () => {
  const url = new URL(
    "./core/session-manager.js",
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  try {
    // oxlint-disable-next-line piano/layer-imports
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

export const savedSession = (content: string, sessionId: string) => {
  const entries = parseSessionEntries(content);
  if (!entries.some((entry) => entry.type === "session" && entry.id === sessionId))
    throw new Error("Missing session header");
  return SessionManager.inMemory(undefined, undefined, entries);
};

export const fileVersion = (info: BigIntStats) =>
  [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(":");
