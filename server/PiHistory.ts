/**
 * Pi's on-disk session history, read without starting an agent. Pi owns history (INV-01): this
 * module only reads it, through the SDK's SessionManager and Pi's session-directory rules
 * (PiEnv), and never moves, merges or repairs a file.
 *
 * A checkout can be named by more than one spelling (a symlink, an older registry path), and Pi
 * records each file under the spelling its CLI was started in. `locate` searches every spelling a
 * caller knows and reports the one file, no file, or a conflict: distinct physical files claiming
 * the same session ID. A conflict is never resolved by choosing one.
 */
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";
import type { Snapshot } from "../shared/wire.ts";
import { compileRedaction, projectDisplay } from "./DisplayProjection.ts";
import { directoryPath, sessionDirFor } from "./PiEnv.ts";
import { type RawMessage, serializeMessages, stateFactsOf } from "./PiRecords.ts";
import { RunLedger } from "./Subagents.ts";

/** Where a session's Pi history is, across the spellings of its checkout. */
export type HistoryLocation =
  | { readonly _tag: "file"; readonly path: string }
  | { readonly _tag: "missing" }
  /** Distinct physical files with the same session ID, as Pi listed them. */
  | { readonly _tag: "conflict"; readonly paths: ReadonlyArray<string> };

export class PiHistoryError extends Data.TaggedError("PiHistoryError")<{
  readonly detail: string;
}> {}

export interface PiHistory {
  /** Find a session's file under any of these checkout spellings, without moving or copying it. */
  readonly locate: (
    sessionId: string,
    checkouts: Iterable<string>,
  ) => Effect.Effect<HistoryLocation, PiHistoryError>;
  /** The session IDs Pi has history for in this directory. An unreadable store has none. */
  readonly sessionIds: (cwd: string) => Effect.Effect<ReadonlySet<string>>;
  /** The active branch of a session file as a Snapshot, with Run usage from every entry, or an empty
   * one without a file. Safe while Pi writes it. */
  readonly peek: (sessionId: string, file: string | undefined) => Effect.Effect<Snapshot>;
  /** Read-only, redacted JSONL of Pi's saved active branch; no agent or extra runtime metadata. */
  readonly exportBranch: (
    sessionId: string,
    file: string | undefined,
  ) => Effect.Effect<string, PiHistoryError>;
}

/** A Snapshot with no history: a session Pi has not written yet, or no session at all. */
export const emptySnapshot = (sessionId: string): Snapshot => ({
  state: { sessionId, isStreaming: false },
  messages: [],
  dialogs: [],
});

// Pi filters a shared session directory by the header's cwd, so each spelling lists its own files.
const listed = (cwd: string) =>
  Effect.promise(() => SessionManager.list(cwd, sessionDirFor(cwd))).pipe(
    Effect.orElseSucceed(() => []),
  );

const locate = Effect.fn("PiHistory.locate")(function* (
  sessionId: string,
  checkouts: Iterable<string>,
): Effect.fn.Return<HistoryLocation, PiHistoryError> {
  // One physical file can be listed through several spellings; count it once.
  const files = new Map<string, string>();
  for (const cwd of new Set([...checkouts].map(directoryPath))) {
    for (const info of yield* listed(cwd)) {
      if (info.id !== sessionId) continue;
      // A listed file must resolve; unlike a checkout it has no missing state to fall back on.
      const physical = yield* Effect.tryPromise({
        try: () => realpath(info.path),
        catch: (error) =>
          new PiHistoryError({
            detail: `Cannot resolve Pi history ${info.path}: ${String(error)}`,
          }),
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

const peekFile = (path: string, sessionId: string): Effect.Effect<Snapshot> =>
  Effect.sync(() => {
    const sm = SessionManager.open(path);
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
    // serializeMessages projects the transcript where Pi content enters; the state is read here.
    return {
      state: projectDisplay({
        ...stateFactsOf({
          sessionId,
          sessionFile: path,
          sessionName: sm.getSessionName(),
          model,
          thinkingLevel: context.thinkingLevel,
          isStreaming: false,
        }),
        subagents: new RunLedger().add(sm.getEntries()).usage,
      }),
      messages: serializeMessages(context.messages as RawMessage[]),
      dialogs: [],
    };
  }).pipe(
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
      // Opening a persistent manager can rewrite legacy/empty files. Pi parses and migrates
      // this read-only snapshot in memory instead; even an old session stays untouched.
      const entries = parseSessionEntries(readFileSync(file, "utf8"));
      if (!entries.some((entry) => entry.type === "session" && entry.id === sessionId))
        throw new Error("Missing session header");
      const manager = SessionManager.inMemory(undefined, undefined, entries);
      const header = manager.getHeader();
      const branch = manager.getBranch();
      if (header?.id !== sessionId || !branch.some((entry) => entry.type === "message"))
        throw new Error("No saved conversation");
      const redaction = compileRedaction();
      // Pi chooses the branch. Preserve its entry vocabulary and IDs, not Piano's display messages.
      return `${[header, ...branch].map((entry) => JSON.stringify(redaction.value(entry))).join("\n")}\n`;
    },
    catch: () =>
      new PiHistoryError({ detail: "This session has no readable saved conversation to share." }),
  });
});

export const PiHistory: PiHistory = {
  exportBranch,
  locate,
  sessionIds,
  peek: (sessionId, file) =>
    file ? peekFile(file, sessionId) : Effect.succeed(emptySnapshot(sessionId)),
};
