/**
 * SessionReadbacks: Pi readbacks and their freshness (INV-03: agent state comes from Pi facts;
 * INV-05: older observations never overwrite newer ones). A readback started before an operation,
 * a fact change or Pi output must not overwrite what is newer than it. This module owns one worker
 * per readback kind, the coalescing of requests, the context retry rule and each readback's error
 * field. Internal to PiSessions, which owns the child and reports new operations here and asks
 * for readbacks. Readbacks land through the session's SessionPublication, whose state changes this
 * module hears to keep its fact versions.
 */
import { Clock, Effect, type Scope } from "effect";
import type { SessionEvent } from "../shared/wire.ts";
import {
  type PiReadback,
  piReadbacks,
  type RawMessage,
  type RawState,
  type RefreshKind,
  stateFactsOf,
} from "./PiRecords.ts";
import type { PiSessionError } from "./PiTransport.ts";
import type { SessionPublication } from "./SessionPublication.ts";
import type { SessionRecordProgress } from "./SessionRecordProgress.ts";

export interface SessionReadbacksOptions {
  /** Workers belong to the session, not to the requesting browser. */
  readonly scope: Scope.Scope;
  readonly read: <A>(readback: PiReadback<A>) => Effect.Effect<A, PiSessionError>;
  /** Pi's live state, failing once Pi no longer holds the hosted session. */
  readonly readState: Effect.Effect<RawState, PiSessionError>;
  /** Pi records received and processed; whether Pi's context may replace projected history. */
  readonly progress: SessionRecordProgress;
  /** Pi's current context as the event replacing projected history; called under the lock. */
  readonly context: (messages: ReadonlyArray<RawMessage>) => SessionEvent;
  readonly publication: SessionPublication;
}

/** An operation token: a state readback owed to one is dropped once a later one starts. */
export type ReadbackOperation = number;

export interface SessionReadbacks {
  /** Run each kind in the background, one worker per kind; requests made while it runs
   * coalesce into one more run. Never awaits Pi. */
  readonly schedule: (...kinds: ReadonlyArray<RefreshKind>) => Effect.Effect<void>;
  /** Run one readback now and wait for it. It never fails: a failure lands in its error field.
   * A state readback is owed to `operation`, by default the current one. */
  readonly refresh: (kind: RefreshKind, operation?: ReadbackOperation) => Effect.Effect<void>;
  /** Start a new operation, superseding state readbacks owed to earlier ones. */
  readonly supersede: () => ReadbackOperation;
  /** The current operation, for work that continues it rather than starting a new one. */
  readonly operation: () => ReadbackOperation;
  /** No readback worker is running. */
  readonly idle: () => boolean;
}

const metadataFields = ["model", "thinkingLevel", "sessionName", "sessionFile"] as const;

/** Readback attempts before a context raced by Pi output becomes a projection error. */
const contextAttempts = 3;

export const makeSessionReadbacks = ({
  scope,
  read,
  readState,
  progress,
  context,
  publication,
}: SessionReadbacksOptions): SessionReadbacks => {
  const factVersions = { model: 0, thinkingLevel: 0, sessionName: 0, sessionFile: 0 };
  let statsVersion = 0;
  let contextVersion = 0;
  let contextPending = false;
  let operationVersion = 0;
  const { announced, patchState } = publication;
  // A readback started before a published change keeps the newer model, effort, name and file.
  publication.onStateChange((previous, next) => {
    for (const field of metadataFields)
      if (next[field] !== previous[field]) factVersions[field] += 1;
  });

  /** Canonical projected context and billed cost from Pi, not partial response usage.
   * Refresh at persisted boundaries, never per token/delta. Best effort.
   */
  const refreshStats = Effect.gen(function* () {
    const version = ++statsVersion;
    const modelVersion = factVersions.model;
    const outputVersion = progress.observed();
    yield* patchState({ contextIsLastKnown: true });
    yield* Effect.gen(function* () {
      const stats = yield* read(piReadbacks.stats);
      const statsUpdatedAt = yield* Clock.currentTimeMillis;
      const current = () =>
        version === statsVersion && modelVersion === factVersions.model && !announced();
      yield* patchState(() =>
        current()
          ? {
              ...stats,
              statsUpdatedAt,
              contextIsLastKnown: outputVersion !== progress.observed(),
              statsRefreshError: undefined,
            }
          : {},
      );
    }).pipe(
      Effect.catchTag("PiSessionError", (error) =>
        patchState(() =>
          announced() || version !== statsVersion
            ? {}
            : {
                contextIsLastKnown: true,
                statsRefreshError: `Usage refresh failed: ${error.detail}`,
              },
        ),
      ),
    );
  });

  /** Read command-controlled facts back from Pi. Do not replace session-level
   * activity with get_state.isStreaming (which describes the low-level run).
   * Neither a stale observation nor an old command may overwrite newer facts.
   */
  const refreshState = Effect.fn("SessionReadbacks.refreshState")(
    function* (operation: ReadbackOperation) {
      if (operation !== operationVersion) return;
      const versions = { ...factVersions };
      const raw = yield* readState;
      yield* patchState(() => {
        if (operation !== operationVersion || announced()) return {};
        const observed = stateFactsOf(raw);
        const patch: Partial<Record<(typeof metadataFields)[number], string | undefined>> = {};
        // Unrelated streaming/queue events must not discard a model observation.
        for (const field of metadataFields)
          if (versions[field] === factVersions[field]) patch[field] = observed[field];
        return { ...patch, stateRefreshError: undefined };
      });
    },
    (effect, operation) =>
      effect.pipe(
        Effect.catchTag("PiSessionError", (error) =>
          announced() || operation !== operationVersion
            ? Effect.void
            : patchState({ stateRefreshError: `Session state refresh failed: ${error.detail}` }),
        ),
      ),
  );

  /** Replace current context, never concatenate raw history. Active work defers to a
   * later boundary without a projection error: the user can do nothing about it, and the
   * boundary retries. Only snapshots raced by Pi output spend the bounded retry budget. */
  const refreshContext = Effect.fn("SessionReadbacks.refreshContext")(function* () {
    const version = ++contextVersion;
    contextPending = false;
    const failed = (detail: string) =>
      patchState(() => {
        if (version !== contextVersion || announced()) return {};
        contextPending = true;
        return { projectionError: detail };
      });
    const unresolved =
      "Pi context changed during refresh. This view may be stale until the next command or settled boundary.";
    const defer = Effect.sync(() => {
      if (version === contextVersion && !announced()) contextPending = true;
    });
    yield* Effect.gen(function* () {
      for (let attempt = 0; attempt < contextAttempts; attempt++) {
        yield* progress.drain;
        const outputVersion = progress.observed();
        const before = yield* readState;
        if (version !== contextVersion || announced()) return;
        const open = yield* publication.transaction(() => Effect.sync(progress.messageOpen));
        if (before.isStreaming || open) return yield* defer;
        const messages = yield* read(piReadbacks.messages);
        // Pi installs finalized agent history before awaiting message_end extension handlers.
        // Even a drained, unchanged output watermark is not sufficient during an active run.
        const state = yield* readState;
        if (version !== contextVersion || announced()) return;
        if (state.isStreaming) return yield* defer;
        const applied = yield* publication.transaction((transaction) =>
          Effect.gen(function* () {
            if (
              version !== contextVersion ||
              !progress.settledSince(outputVersion) ||
              state.isStreaming ||
              announced()
            )
              return false;
            yield* transaction.publish(context(messages));
            yield* transaction.mergeState({ projectionError: undefined });
            contextPending = false;
            return true;
          }),
        );
        if (applied) return;
      }
      yield* failed(unresolved);
    }).pipe(
      Effect.catchTag("PiSessionError", (error) =>
        failed(`Current context refresh failed: ${error.detail}`),
      ),
    );
  });

  const refresh = (kind: RefreshKind, operation?: ReadbackOperation): Effect.Effect<void> =>
    kind === "stats"
      ? refreshStats
      : kind === "context"
        ? refreshContext()
        : Effect.suspend(() => refreshState(operation ?? operationVersion));

  // At most one worker per readback kind. Never await RPC inspection from the
  // record consumer: Pi may need a later dialog answered before replying.
  const refreshing = new Set<RefreshKind>();
  const requested = new Set<RefreshKind>();
  const schedule = Effect.fnUntraced(function* (...kinds: ReadonlyArray<RefreshKind>) {
    // Retry an unresolved context at the next persisted boundary, not in an unbounded loop.
    const retry = contextPending && kinds.includes("stats") ? ["context" as const] : [];
    for (const kind of new Set([...kinds, ...retry])) {
      requested.add(kind);
      if (refreshing.has(kind)) continue;
      refreshing.add(kind);
      yield* Effect.gen(function* () {
        while (requested.delete(kind) && !announced()) yield* refresh(kind);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            refreshing.delete(kind);
          }),
        ),
        Effect.forkIn(scope),
      );
    }
  });

  return {
    schedule,
    refresh,
    supersede: () => ++operationVersion,
    operation: () => operationVersion,
    idle: () => refreshing.size === 0,
  };
};
