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
  dispatchedFromOf,
  type PiReadback,
  piReadbacks,
  type RawMessage,
  type RefreshKind,
  stateFactsOf,
} from "./PiRecords.ts";
import type { PiSessionError } from "./PiTransport.ts";
import type { SessionPublication } from "./SessionPublication.ts";
import { RunLedger } from "./Subagents.ts";

export interface SessionReadbacksOptions {
  /** Workers belong to the session, not to the requesting browser. */
  readonly scope: Scope.Scope;
  readonly read: <A>(readback: PiReadback<A>) => Effect.Effect<A, PiSessionError>;
  /** Moves with every Pi record received; a readback it moved during may already be stale. */
  readonly observationVersion: () => number;
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
  observationVersion,
  context,
  publication,
}: SessionReadbacksOptions): SessionReadbacks => {
  const factVersions = { model: 0, thinkingLevel: 0, sessionName: 0, sessionFile: 0 };
  let statsVersion = 0;
  let contextVersion = 0;
  let operationVersion = 0;
  const { announced, patchState } = publication;
  // A readback started before a published change keeps the newer model, effort, name and file.
  publication.onStateChange((previous, next) => {
    for (const field of metadataFields)
      if (next[field] !== previous[field]) factVersions[field] += 1;
  });

  /** Run usage, and the dispatching session, from entries Pi appended since the last read. Only
   * the stats worker reads. */
  const ledger = new RunLedger();
  let dispatchedFrom: string | undefined;
  const readEntries = Effect.gen(function* () {
    const entries = (since?: string) => read(piReadbacks.entries(since));
    const since = ledger.since;
    // A session that no longer holds the last entry read is counted afresh.
    const added = yield* entries(since).pipe(
      Effect.catchTag("PiSessionError", (error) =>
        since
          ? Effect.sync(() => ledger.reset()).pipe(Effect.andThen(entries()))
          : Effect.fail(error),
      ),
    );
    ledger.add(added);
    dispatchedFrom ??= dispatchedFromOf(added);
    return { subagents: ledger.usage, dispatchedFrom };
  });

  /** Canonical projected context and billed cost from Pi, not partial response usage.
   * Refresh at persisted boundaries, never per token/delta. Best effort.
   */
  const refreshStats = Effect.gen(function* () {
    const version = ++statsVersion;
    const modelVersion = factVersions.model;
    const outputVersion = observationVersion();
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
              contextIsLastKnown: outputVersion !== observationVersion(),
              statsRefreshError: undefined,
            }
          : {},
      );
      // Pi's figures above neither wait on nor fail with the Runs' entries; a failed read keeps
      // the last count, and the next refresh continues from the last entry read.
      const fromEntries = yield* readEntries.pipe(Effect.option);
      if (fromEntries._tag === "Some")
        yield* patchState(() => (current() ? fromEntries.value : {}));
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
      const raw = yield* read(piReadbacks.state);
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

  /** Replace current context, never concatenate raw history. Retry readbacks
   * raced by Pi output; bound churn and make an unresolved projection visible.
   * This is not historical replay or the phase-5 transport sequencing contract. */
  const refreshContext = Effect.gen(function* () {
    const version = ++contextVersion;
    for (let attempt = 0; attempt < contextAttempts; attempt++) {
      const outputVersion = observationVersion();
      const messages = yield* read(piReadbacks.messages);
      if (version !== contextVersion || announced()) return;
      const applied = yield* publication.transaction((transaction) =>
        Effect.gen(function* () {
          if (version !== contextVersion || outputVersion !== observationVersion() || announced())
            return false;
          yield* transaction.publish(context(messages));
          return true;
        }),
      );
      if (applied) return yield* patchState({ projectionError: undefined });
    }
    yield* patchState({
      projectionError:
        "Pi context changed during refresh. This view may be stale until the next command or settled boundary.",
    });
  }).pipe(
    Effect.catchTag("PiSessionError", (error) =>
      patchState({ projectionError: `Current context refresh failed: ${error.detail}` }),
    ),
  );

  const refresh = (kind: RefreshKind, operation?: ReadbackOperation): Effect.Effect<void> =>
    kind === "stats"
      ? refreshStats
      : kind === "context"
        ? refreshContext
        : Effect.suspend(() => refreshState(operation ?? operationVersion));

  // At most one worker per readback kind. Never await RPC inspection from the
  // record consumer: Pi may need a later dialog answered before replying.
  const refreshing = new Set<RefreshKind>();
  const requested = new Set<RefreshKind>();
  const schedule = Effect.fnUntraced(function* (...kinds: ReadonlyArray<RefreshKind>) {
    for (const kind of kinds) {
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
