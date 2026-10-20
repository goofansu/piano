/**
 * Internal to PiSessions, which exposes it as `history`: Pi's on-disk session history, read
 * without starting an agent. Pi owns history (INV-01): this module only reads it, through the SDK's
 * SessionManager and Pi's session-directory rules (PiEnv), and never moves, merges or repairs a
 * file. It reads a file's facts; PiRecords alone turns them into a Snapshot, as it does a live
 * session's readbacks.
 *
 * A checkout can be named by more than one spelling (a symlink, an older registry path), and Pi
 * records each file under the spelling its CLI was started in. `locate` searches every spelling a
 * caller knows and reports the one file, no file, or a conflict: distinct physical files claiming
 * the same session ID. A conflict is never resolved by choosing one.
 */
import { type BigIntStats, createReadStream, readFileSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  type FileEntry,
  parseSessionEntries,
  type SessionHeader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { emptySnapshot } from "../shared/sessionProjection.ts";
import type { Snapshot } from "../shared/wire.ts";
import { compileRedaction, projectSnapshot } from "./DisplayProjection.ts";
import { agentDir, directoryPath, sessionDirFor } from "./PiEnv.ts";
import { type PiSessionFacts, type RawMessage, snapshotOf } from "./PiRecords.ts";
import { PiSessionError } from "./PiTransport.ts";

/** Where a session's Pi history is, across the spellings of its checkout. */
export type HistoryLocation =
  | { readonly _tag: "file"; readonly path: string }
  | { readonly _tag: "missing" }
  /** Distinct physical files with the same session ID, as Pi listed them. */
  | { readonly _tag: "conflict"; readonly paths: ReadonlyArray<string> };

/** Saved sessions, read without starting Pi. */
export interface PiHistory {
  /** Find a session's file under any of these checkout spellings, without moving or copying it. */
  readonly locate: (
    sessionId: string,
    checkouts: Iterable<string>,
  ) => Effect.Effect<HistoryLocation, PiSessionError>;
  /** The session IDs Pi has history for in this directory. An unreadable store has none. */
  readonly sessionIds: (cwd: string) => Effect.Effect<ReadonlySet<string>>;
  /** The active branch of a session file as a Snapshot, with Run usage from every entry, or an empty
   * one without a file. Safe while Pi writes it. */
  readonly peek: (sessionId: string, file: string | undefined) => Effect.Effect<Snapshot>;
  /** Read-only, redacted JSONL of Pi's saved active branch; no agent or extra runtime metadata. */
  readonly exportBranch: (
    sessionId: string,
    file: string | undefined,
  ) => Effect.Effect<string, PiSessionError>;
}

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });

// Pi's list() builds searchable text from every transcript. Discovery needs only headers, but
// findById() returns the first match and would hide conflicting files. Read every header instead,
// without opening a persistent manager. Stop at the first parsed entry, as Pi's list() does;
// do not cap valid headers, which Pi may still open beyond findById()'s discovery limit.
const readHeader = async (file: string): Promise<SessionHeader | undefined> => {
  const input = createReadStream(file, { highWaterMark: 4096 });
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const header = (line: string) => {
    // Pi parses physical lines without trimming them. parseSessionEntries() trims its input,
    // accepting e.g. a BOM-prefixed header that Pi's persistent file loader cannot open.
    let entry: FileEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      return undefined;
    }
    return entry
      ? entry.type === "session" && typeof entry.id === "string"
        ? entry
        : null
      : undefined;
  };
  // Exiting the iterator closes the stream, including errors and an early header match.
  for await (const chunk of input) {
    pending += decoder.write(chunk);
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const found = header(pending.slice(0, newline));
      if (found !== undefined) return found ?? undefined;
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  return header(pending + decoder.end()) ?? undefined;
};

/** Pi parses and migrates only in memory: a persistent manager can rewrite legacy/empty files. */
const readSession = (path: string, sessionId: string): SessionManager => {
  const entries = parseSessionEntries(readFileSync(path, "utf8"));
  if (!entries.some((entry) => entry.type === "session" && entry.id === sessionId))
    throw new Error("Missing session header");
  return SessionManager.inMemory(undefined, undefined, entries);
};

/** A saved session's facts as Pi would report them, read from its file. */
const savedFacts = (path: string, sessionId: string): PiSessionFacts => {
  const sm = readSession(path, sessionId);
  // Use Pi's own compaction/context-edit/active-branch projection, the same
  // display scope as RPC get_messages. Never infer selection from an answer.
  const context = sm.buildSessionContext();
  // Pi's context builder uses the last assistant's physical model. Selection
  // is recorded separately; this read-only peek cannot check whether a virtual
  // model is still registered. The next CLI open confirms/falls back itself.
  const selection = sm.getBranch().findLast((entry) => entry.type === "model_change");
  const model =
    selection?.type === "model_change"
      ? { provider: selection.provider, id: selection.modelId }
      : context.model
        ? { provider: context.model.provider, id: context.model.modelId }
        : undefined;
  return {
    source: "saved",
    state: {
      sessionId,
      sessionFile: path,
      sessionName: sm.getSessionName(),
      model,
      thinkingLevel: context.thinkingLevel,
      isStreaming: false,
    },
    messages: context.messages as RawMessage[],
    entries: sm.getEntries(),
  };
};

const peekFile = (path: string, sessionId: string): Effect.Effect<Snapshot> =>
  // The transcript was projected for display as it was built; the rest is projected here.
  Effect.try(() => projectSnapshot(snapshotOf(savedFacts(path, sessionId)))).pipe(
    Effect.orElseSucceed(() => ({
      state: {
        sessionId,
        sessionFile: path,
        isStreaming: false,
        projectionError:
          "Could not read Pi's current context. History was not replaced or repaired.",
      },
      messages: [],
      dialogs: [],
    })),
  );

const exportBranch = Effect.fn("PiHistory.exportBranch")(function* (
  sessionId: string,
  file: string | undefined,
) {
  return yield* Effect.try({
    try: () => {
      if (!file) throw new Error("Missing history");
      const manager = readSession(file, sessionId);
      const header = manager.getHeader();
      const branch = manager.getBranch();
      if (header?.id !== sessionId || !branch.some((entry) => entry.type === "message"))
        throw new Error("No saved conversation");
      const redaction = compileRedaction();
      // Pi chooses the branch. Preserve its entry vocabulary and IDs, not Piano's display messages.
      return `${[header, ...branch].map((entry) => JSON.stringify(redaction.value(entry))).join("\n")}\n`;
    },
    catch: () => rejected("This session has no readable saved conversation to share."),
  });
});

// Only discovery metadata is retained, never transcripts or arbitrary header metadata. Every
// lookup still enumerates the store and stats each candidate: directory mtime alone cannot detect
// in-place rewrites. ctime detects same-size rewrites with restored mtime, but even nanosecond
// stat fields can share a filesystem clock tick. Do not cache recent writes until that tick is
// safely past; this also keeps active/partial histories on the real-read path.
const headerVersion = (info: BigIntStats) =>
  [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(":");
const HEADER_CACHE_LIMIT = 4096;

/** A disposable, bounded header cache owned by one PiSessions service. */
export const makePiHistory = (): PiHistory => {
  const headers = new Map<string, { version: string; info: Pick<SessionHeader, "id" | "cwd"> }>();
  const header = async (path: string) => {
    try {
      const before = await stat(path, { bigint: true });
      const version = headerVersion(before);
      const cached = headers.get(path);
      // Refresh insertion order for LRU eviction. A failed/unstable read never enters the cache.
      headers.delete(path);
      if (cached?.version === version) {
        headers.set(path, cached);
        return cached.info;
      }
      const found = await readHeader(path);
      if (!found) return undefined;
      const info = { id: found.id, cwd: found.cwd };
      if (
        before.ctimeMs < BigInt(Date.now() - 1000) &&
        headerVersion(await stat(path, { bigint: true })) === version
      ) {
        headers.set(path, { version, info });
        if (headers.size > HEADER_CACHE_LIMIT) headers.delete(headers.keys().next().value!);
      }
      return info;
    } catch (error) {
      headers.delete(path);
      throw error;
    }
  };

  const listed = Effect.fn("PiHistory.listed")(function* (cwd: string) {
    // Match Pi's default directory encoding. Only a non-default shared store filters by header cwd;
    // old headers in a checkout's own store may omit cwd. Never create a store while inspecting it.
    const defaultDir = join(
      directoryPath(agentDir()),
      "sessions",
      `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
    );
    const dir = sessionDirFor(cwd) ?? defaultDir;
    const names = yield* Effect.tryPromise(() => readdir(dir)).pipe(Effect.orElseSucceed(() => []));
    const infos = yield* Effect.forEach(
      names.filter((name) => name.endsWith(".jsonl")),
      (name) =>
        Effect.tryPromise(async () => {
          const path = join(dir, name);
          const info = await header(path);
          if (
            !info ||
            (dir !== defaultDir &&
              (typeof info.cwd !== "string" || !info.cwd || directoryPath(info.cwd) !== cwd))
          )
            return undefined;
          return { id: info.id, path };
        }).pipe(Effect.orElseSucceed(() => undefined)),
      { concurrency: 16 },
    );
    return infos.filter((info) => info !== undefined);
  });

  const locate = Effect.fn("PiHistory.locate")(function* (
    sessionId: string,
    checkouts: Iterable<string>,
  ): Effect.fn.Return<HistoryLocation, PiSessionError> {
    // One physical file can be listed through several spellings; count it once.
    const files = new Map<string, string>();
    for (const cwd of new Set([...checkouts].map(directoryPath))) {
      for (const info of yield* listed(cwd)) {
        if (info.id !== sessionId) continue;
        // A listed file must resolve; unlike a checkout it has no missing state to fall back on.
        const physical = yield* Effect.tryPromise({
          try: () => realpath(info.path),
          catch: (error) => rejected(`Cannot resolve Pi history ${info.path}: ${String(error)}`),
        });
        files.set(physical, info.path);
      }
    }
    const paths = [...files.values()];
    return paths.length === 0
      ? { _tag: "missing" }
      : paths.length === 1
        ? { _tag: "file", path: paths[0] }
        : { _tag: "conflict", paths };
  });

  const sessionIds = (cwd: string): Effect.Effect<ReadonlySet<string>> =>
    Effect.map(listed(directoryPath(cwd)), (infos) => new Set(infos.map((info) => info.id)));

  return {
    exportBranch,
    locate,
    sessionIds,
    peek: (sessionId, file) =>
      file ? peekFile(file, sessionId) : Effect.succeed(emptySnapshot(sessionId)),
  };
};
