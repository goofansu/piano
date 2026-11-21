import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { FileEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import { Effect, type Scope } from "effect";
import { readLocalFile } from "../../../../server/shared/LocalFile.ts";
import { agentDir, directoryPath, sessionDirFor } from "../../../../server/shared/PiEnv.ts";
import { emptySnapshot } from "../../../../shared/session/sessionProjection.ts";
import type { Snapshot } from "../../../../shared/wire.ts";
import { fileVersion } from "./PiHistoryFile.ts";
import { PiHistoryJobs } from "./PiHistoryJobs.ts";
import type { HistoryMetadata } from "./PiHistoryWorker.ts";
import { PiSessionError } from "./PiTransport.ts";

export type HistoryLocation =
  | { readonly _tag: "file"; readonly path: string }
  | { readonly _tag: "missing" }
  | { readonly _tag: "conflict"; readonly paths: ReadonlyArray<string> };

export interface PiHistory {
  readonly locate: (
    sessionId: string,
    checkouts: Iterable<string>,
    options?: { readonly confirmAbsent?: boolean },
  ) => Effect.Effect<HistoryLocation, PiSessionError>;
  readonly sessionIds: (cwd: string) => Effect.Effect<ReadonlySet<string>>;
  readonly savedJsonl: (
    sessionId: string,
    file: string,
    limit: number,
  ) => Effect.Effect<string, PiSessionError>;
  readonly peek: (sessionId: string, file: string | undefined) => Effect.Effect<Snapshot>;
  readonly metadata: (
    sessionId: string,
    file: string,
  ) => Effect.Effect<HistoryMetadata, PiSessionError>;
}

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });

const readHeader = async (file: string): Promise<SessionHeader | undefined> => {
  const input = createReadStream(file, { highWaterMark: 4096 });
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const header = (line: string) => {
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

const HEADER_CACHE_LIMIT = 4096;

export const makePiHistory = Effect.fn("PiHistory.make")(function* (): Effect.fn.Return<
  PiHistory,
  never,
  Scope.Scope
> {
  const jobs = new PiHistoryJobs();
  yield* Effect.addFinalizer(() => Effect.promise(() => jobs.close()));

  const peekFile = (path: string, sessionId: string): Effect.Effect<Snapshot> =>
    Effect.promise(() => jobs.read({ operation: "peek", path, sessionId })).pipe(
      Effect.map((reply) =>
        "value" in reply
          ? (reply.value as Snapshot)
          : {
              state: {
                sessionId,
                sessionFile: path,
                isStreaming: false,
                projectionError:
                  "Could not read Pi's current context. History was not replaced or repaired.",
              },
              messages: [],
              dialogs: [],
            },
      ),
    );

  const metadata = Effect.fn("PiHistory.metadata")(function* (sessionId: string, file: string) {
    const reply = yield* Effect.promise(() =>
      jobs.read({ operation: "metadata", path: file, sessionId }),
    );
    if ("value" in reply) return reply.value as HistoryMetadata;
    return yield* rejected(`Cannot read session metadata from Pi history ${file}.`);
  });

  const headers = new Map<string, { version: string; info: Pick<SessionHeader, "id" | "cwd"> }>();
  const header = async (path: string, scanHeaders: typeof headers) => {
    try {
      const before = await stat(path, { bigint: true });
      const version = fileVersion(before);
      const cached = headers.get(path) ?? scanHeaders.get(path);
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
        fileVersion(await stat(path, { bigint: true })) === version
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

  const listed = Effect.fn("PiHistory.listed")(function* (cwd: string, strict = false) {
    const defaultDir = join(
      directoryPath(agentDir()),
      "sessions",
      `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
    );
    const dir = sessionDirFor(cwd) ?? defaultDir;
    const names = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(dir);
        } catch (error) {
          if (!strict || (error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
      },
      catch: (error) => rejected(`Cannot inspect Pi history ${dir}: ${String(error)}`),
    });
    const scanHeaders = new Map(headers);
    const infos = yield* Effect.forEach(
      names.filter((name) => name.endsWith(".jsonl")),
      (name) =>
        Effect.tryPromise({
          try: async () => {
            const path = join(dir, name);
            const info = await header(path, scanHeaders);
            if (strict && !info) throw new Error(`Unreadable session header: ${path}`);
            if (
              !info ||
              (!strict &&
                dir !== defaultDir &&
                (typeof info.cwd !== "string" || !info.cwd || directoryPath(info.cwd) !== cwd))
            )
              return undefined;
            return { id: info.id, path };
          },
          catch: (error) => rejected(`Cannot inspect Pi history: ${String(error)}`),
        }).pipe(
          Effect.catchTag("PiSessionError", (error) =>
            strict ? Effect.fail(error) : Effect.succeed(undefined),
          ),
        ),
      { concurrency: 16 },
    );
    return infos.filter((info) => info !== undefined);
  });

  const locate = Effect.fn("PiHistory.locate")(function* (
    sessionId: string,
    checkouts: Iterable<string>,
    options?: { readonly confirmAbsent?: boolean },
  ): Effect.fn.Return<HistoryLocation, PiSessionError> {
    const files = new Map<string, string>();
    for (const cwd of new Set([...checkouts].map(directoryPath))) {
      for (const info of yield* listed(cwd, options?.confirmAbsent)) {
        if (info.id !== sessionId) continue;
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
    listed(directoryPath(cwd)).pipe(
      Effect.map((infos) => new Set(infos.map((info) => info.id))),
      Effect.orElseSucceed(() => new Set<string>()),
    );

  const savedJsonl = (sessionId: string, file: string, limit: number) =>
    Effect.tryPromise({
      try: async (signal) => {
        const before = fileVersion(await stat(file, { bigint: true }));
        const bytes = await readLocalFile(file, { limit, signal });
        if (!bytes.length || fileVersion(await stat(file, { bigint: true })) !== before)
          throw new Error("changed");
        const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        const lines = content.trimEnd().split("\n");
        for (const [index, line] of lines.entries()) {
          const entry = JSON.parse(line);
          if (
            !entry ||
            typeof entry !== "object" ||
            Array.isArray(entry) ||
            (index === 0 && (entry.type !== "session" || entry.id !== sessionId))
          )
            throw new Error("invalid history");
        }
        return content;
      },
      catch: () => rejected("Could not read a complete saved session."),
    });

  return {
    savedJsonl,
    metadata,
    locate,
    sessionIds,
    peek: (sessionId, file) =>
      file ? peekFile(file, sessionId) : Effect.succeed(emptySnapshot(sessionId)),
  };
});
