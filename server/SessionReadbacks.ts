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
  readonly scope: Scope.Scope;
  readonly read: <A>(readback: PiReadback<A>) => Effect.Effect<A, PiSessionError>;
  readonly readState: Effect.Effect<RawState, PiSessionError>;
  readonly progress: SessionRecordProgress;
  readonly context: (messages: ReadonlyArray<RawMessage>) => SessionEvent;
  readonly publication: SessionPublication;
}

export type ReadbackOperation = number;

export interface SessionReadbacks {
  readonly schedule: (...kinds: ReadonlyArray<RefreshKind>) => Effect.Effect<void>;
  readonly refresh: (kind: RefreshKind, operation?: ReadbackOperation) => Effect.Effect<void>;
  readonly supersede: () => ReadbackOperation;
  readonly operation: () => ReadbackOperation;
  readonly idle: () => boolean;
}

const metadataFields = ["model", "thinkingLevel", "sessionName", "sessionFile"] as const;

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
  publication.onStateChange((previous, next) => {
    for (const field of metadataFields)
      if (next[field] !== previous[field]) factVersions[field] += 1;
  });

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

  const refreshState = Effect.fn("SessionReadbacks.refreshState")(
    function* (operation: ReadbackOperation) {
      if (operation !== operationVersion) return;
      const versions = { ...factVersions };
      const raw = yield* readState;
      yield* patchState(() => {
        if (operation !== operationVersion || announced()) return {};
        const observed = stateFactsOf(raw);
        const patch: Partial<Record<(typeof metadataFields)[number], string | undefined>> = {};
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

  const refreshing = new Set<RefreshKind>();
  const requested = new Set<RefreshKind>();
  const schedule = Effect.fnUntraced(function* (...kinds: ReadonlyArray<RefreshKind>) {
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
