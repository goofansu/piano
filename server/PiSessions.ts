import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { ChildProcessSpawner as Spawner } from "effect/process";

const ChildProcessSpawner = Spawner.ChildProcessSpawner;
type ChildProcessSpawner = Spawner.ChildProcessSpawner;

import { PROJECT_INSTRUCTIONS_ENV } from "../shared/dispatch.ts";
import { withLastKnownStats } from "../shared/sessionProjection.ts";
import { liveActivityOf } from "../shared/sessionStatus.ts";
import type {
  ModelChoice,
  PromptSubmission,
  SessionAction,
  SessionActionResult,
  SessionClosure,
  SessionFrame,
  SessionState,
  SessionStats,
  SlashCommand,
  Snapshot,
} from "../shared/wire.ts";
import type { DeliveryOverflow } from "./BoundedDelivery.ts";
import { projectDisplay, projectState } from "./DisplayProjection.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { inputBytes } from "./InputBytes.ts";
import { makePiHistory, type PiHistory } from "./PiHistory.ts";
import {
  dispatchedFromOf,
  inputFingerprint,
  type PiExchange,
  PiProjector,
  type PiRecord,
  type PiRejection,
  piExchangeFor,
  piReadbacks,
  type RefreshKind,
  sessionArgs,
  stateFactsOf,
} from "./PiRecords.ts";
import { type PiLane, PiSessionError, PiTransport, refusedUnsent } from "./PiTransport.ts";
import { makeSessionDialogs } from "./SessionDialogs.ts";
import { makeSessionPublication } from "./SessionPublication.ts";
import { makeSessionReadbacks } from "./SessionReadbacks.ts";
import { makeSessionRecordProgress } from "./SessionRecordProgress.ts";

export interface PiSessionSpec {
  readonly cwd: string;
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly name?: string;
  readonly dispatchedFrom?: string;
  readonly lastKnownStats?: SessionStats;
  readonly projectInstructions?: string;
}

export interface PiSession {
  readonly spec: PiSessionSpec;
  readonly requestRelease: Effect.Effect<void>;
  readonly events: Stream.Stream<SessionFrame, DeliveryOverflow>;
  readonly act: (
    action: SessionAction,
  ) => Effect.Effect<SessionActionResult | undefined, PiSessionError>;
  readonly state: Effect.Effect<SessionState>;
  readonly commands: Effect.Effect<ReadonlyArray<SlashCommand>, PiSessionError>;
}

export interface ProbeResult {
  readonly commands: ReadonlyArray<SlashCommand>;
  readonly models: ReadonlyArray<ModelChoice>;
  readonly defaultModel?: string;
  readonly defaultThinkingLevel?: string;
}

export class PiSessions extends Context.Service<
  PiSessions,
  {
    readonly open: (spec: PiSessionSpec) => Effect.Effect<PiSession, PiSessionError, Scope.Scope>;
    readonly probe: (
      cwd: string,
      options?: { globalSettingsOnly?: boolean },
    ) => Effect.Effect<ProbeResult, PiSessionError>;
    readonly history: PiHistory;
  }
>()("piano/PiSessions") {}

export interface SessionActionPolicy {
  readonly priority: boolean;
  readonly supersedes: boolean;
  readonly blockedWhileStopping: boolean;
  readonly needsCheckout: boolean;
  readonly activity: boolean;
}

export const sessionActionPolicy: Readonly<Record<SessionAction["_tag"], SessionActionPolicy>> = {
  prompt: {
    priority: false,
    supersedes: true,
    blockedWhileStopping: true,
    needsCheckout: true,
    activity: true,
  },
  steer: {
    priority: false,
    supersedes: true,
    blockedWhileStopping: true,
    needsCheckout: true,
    activity: true,
  },
  abort: {
    priority: true,
    supersedes: false,
    blockedWhileStopping: true,
    needsCheckout: false,
    activity: false,
  },
  stop: {
    priority: true,
    supersedes: false,
    blockedWhileStopping: true,
    needsCheckout: false,
    activity: false,
  },
  restore_queue: {
    priority: true,
    supersedes: false,
    blockedWhileStopping: true,
    needsCheckout: true,
    activity: false,
  },
  set_model: {
    priority: false,
    supersedes: true,
    blockedWhileStopping: false,
    needsCheckout: true,
    activity: false,
  },
  set_thinking_level: {
    priority: false,
    supersedes: true,
    blockedWhileStopping: false,
    needsCheckout: true,
    activity: false,
  },
  set_name: {
    priority: false,
    supersedes: true,
    blockedWhileStopping: false,
    needsCheckout: true,
    activity: false,
  },
  answer: {
    priority: true,
    supersedes: false,
    blockedWhileStopping: false,
    needsCheckout: true,
    activity: false,
  },
};

const laneOf = (tag: SessionAction["_tag"]): PiLane =>
  sessionActionPolicy[tag].priority ? "control" : "ordinary";

const exchangeOf = <A>(
  translation: PiExchange<A> | PiRejection,
): Effect.Effect<PiExchange<A>, PiSessionError> =>
  "rejected" in translation
    ? Effect.fail(new PiSessionError({ reason: "rejected", detail: translation.rejected }))
    : Effect.succeed(translation);

export type { HistoryLocation, PiHistory } from "./PiHistory.ts";
export { PiRequestTimeoutMs, PiSessionError, refusedUnsent } from "./PiTransport.ts";

export const PiDialogRecoveryMs = Context.Reference<number>("piano/PiDialogRecoveryMs", {
  defaultValue: () => 10 * 60_000,
});

const settled = (snapshot: Snapshot) => liveActivityOf(snapshot)._tag === "idle";

const redactedErrors = <A>(effect: Effect.Effect<A, PiSessionError>) =>
  effect.pipe(
    Effect.mapError(
      (error) =>
        new PiSessionError({
          reason: error.reason,
          detail: projectDisplay(error.detail),
          ...(error.notSent ? { notSent: true } : {}),
        }),
    ),
  );

const replacedDetail =
  "Pi switched this process to another session, so Piano closed it. Reopen this session to continue; no input was resent.";

const openSession = (
  spec: PiSessionSpec,
  history: PiHistory,
  spawned: (child: PiTransport) => void,
) =>
  Effect.gen(function* () {
    const generation = randomUUID();
    const child = yield* PiTransport.spawn(sessionArgs(spec), spec.cwd, {
      env: {
        ...(spec.projectInstructions
          ? { [PROJECT_INSTRUCTIONS_ENV]: spec.projectInstructions }
          : {}),
      },
    });
    spawned(child);
    const sessionScope = yield* Effect.scope;
    const recoveryMs = yield* PiDialogRecoveryMs;

    const readMetadata = (file: string | undefined) =>
      file && existsSync(file)
        ? history.metadata(spec.sessionId, file)
        : child.read(piReadbacks.entries()).pipe(
            Effect.map((entries) => ({
              dispatchedFrom: dispatchedFromOf(entries),
              artifacts: [],
            })),
          );

    const [state, metadata] = yield* child.read(piReadbacks.state).pipe(
      Effect.flatMap((state) =>
        readMetadata(state.sessionFile).pipe(
          Effect.catchTag("PiSessionError", () =>
            Effect.succeed({ dispatchedFrom: undefined, artifacts: [] }),
          ),
          Effect.map((metadata) => [state, metadata] as const),
        ),
      ),
      Effect.raceFirst(
        Deferred.await(child.exited).pipe(
          Effect.flatMap(
            (closure) => new PiSessionError({ reason: "spawn", detail: closure.detail }),
          ),
        ),
      ),
    );
    const projector = new PiProjector({ generation });
    const opened = projector.snapshot({
      source: "live",
      state,
      messages: [],
      ...metadata,
    });
    if (opened.state.sessionId !== spec.sessionId)
      return yield* new PiSessionError({
        reason: "protocol",
        detail:
          "Pi opened a different session ID. History was not merged; check the saved reference.",
      });
    const publication = yield* makeSessionPublication({
      cwd: spec.cwd,
      sessionId: spec.sessionId,
      generation,
      initial: {
        ...opened,
        state: withLastKnownStats(opened.state, spec.lastKnownStats),
        tools: [],
      },
    });
    const { transaction, apply, patchState, announced } = publication;
    let submissionId = 0;

    const progress = makeSessionRecordProgress({ observed: child.observationVersion });
    let initializing = true;
    const initialRefreshes = new Set<RefreshKind>();
    const promptOperations = new Set<number>();
    let aborting:
      | {
          dispatched: Deferred.Deferred<void>;
          pendingPrompts: Set<number>;
          acknowledged: boolean;
        }
      | undefined;

    const dialogs = makeSessionDialogs({
      generation,
      recoveryMs,
      scope: sessionScope,
      write: (command) => child.write(command, { lane: laneOf("answer") }),
      publication,
      abortInProgress: () => aborting?.dispatched,
    });

    const endAbortingPrompt = (operation: number) =>
      Effect.sync(() => {
        promptOperations.delete(operation);
        aborting?.pendingPrompts.delete(operation);
        if (aborting?.acknowledged && aborting.pendingPrompts.size === 0) aborting = undefined;
      });

    const readState = Effect.gen(function* () {
      const state = yield* child.read(piReadbacks.state);
      if (state.sessionId === spec.sessionId) return state;
      yield* child.fail(replacedDetail);
      return yield* new PiSessionError({ reason: "protocol", detail: replacedDetail });
    });

    const readbacks = makeSessionReadbacks({
      scope: sessionScope,
      read: child.read,
      readState,
      progress,
      context: (messages) => ({ _tag: "context", messages: projector.history(messages) }),
      publication,
    });

    const onRecord = Effect.fnUntraced(function* ({
      record,
      receivedAt,
    }: {
      record: PiRecord;
      receivedAt: number;
    }) {
      if (announced()) return;
      const { refresh, dialog } = yield* transaction((tx) =>
        Effect.gen(function* () {
          progress.project(record);
          const projected = projector.record(record, receivedAt);
          if (projected.state) yield* tx.mergeState(projected.state);
          for (const event of projected.events) yield* tx.publish(event);
          if (projected.toolEnded) yield* dialogs.toolEnded(tx, projected.toolEnded);
          if (projected.runStarted) yield* dialogs.runStarted(tx);
          return {
            refresh: projected.refresh,
            dialog: projected.dialog && (yield* dialogs.opened(tx, projected.dialog)),
          };
        }),
      );
      if (initializing) for (const kind of refresh) initialRefreshes.add(kind);
      else yield* readbacks.schedule(...refresh);
      if (dialog) yield* dialogs.watch(dialog);
    });

    const recordsDrained = yield* Deferred.make<void>();
    yield* child.records.pipe(
      Stream.runForEach((item) => onRecord(item).pipe(Effect.ensuring(progress.processed()))),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : child.fail(
              "Pi record processing failed. Reopen history before continuing; do not automatically resend input.",
            ),
      ),
      Effect.ensuring(Deferred.succeed(recordsDrained, undefined)),
      Effect.forkScoped,
    );

    const announceClosed = (closure: Effect.Effect<SessionClosure>) =>
      Effect.suspend(() => {
        if (!publication.announce()) return Effect.void;
        return Effect.gen(function* () {
          const final = yield* closure;
          const submission = (yield* publication.state).submission;
          if (submission?.outcome === "submitting")
            yield* apply([
              {
                _tag: "submission",
                submission: {
                  ...submission,
                  outcome: "uncertain",
                  detail: `Pi stopped before acknowledging this input: ${final.detail}`,
                },
              },
            ]);
          yield* dialogs.resolveAll("exited");
          yield* apply(() => [...projector.closed(), { _tag: "closed", closure: final }]);
        });
      });
    let releaseRequested = false;
    yield* Effect.addFinalizer(() =>
      announceClosed(
        Effect.map(publication.snapshot, (snapshot): SessionClosure =>
          settled(snapshot) && !child.hasPendingWork()
            ? { _tag: "released", detail: "Pi was released" }
            : releaseRequested
              ? { _tag: "stopped", detail: "Pi was stopped during work" }
              : { _tag: "released_during_work", detail: "Pi was released during work" },
        ),
      ),
    );
    yield* Deferred.await(child.exited).pipe(
      Effect.flatMap((closure) =>
        Deferred.await(recordsDrained).pipe(
          Effect.andThen(announceClosed(Effect.succeed(closure))),
        ),
      ),
      Effect.forkScoped,
    );

    const present = (snapshot: Snapshot): SessionState => ({
      ...snapshot.state,
      isQuiescent:
        !announced() &&
        !child.hasPendingWork() &&
        progress.caughtUp() &&
        readbacks.idle() &&
        promptOperations.size === 0 &&
        settled(snapshot),
    });
    const events: Stream.Stream<SessionFrame, DeliveryOverflow> = publication.subscribe(present);

    let stopping = false;
    const exited = () =>
      refusedUnsent(
        "exited",
        "Pi has stopped. Reopen history before sending new input; interrupted operations do not resume.",
      );
    const act = (
      action: SessionAction,
    ): Effect.Effect<SessionActionResult | undefined, PiSessionError> =>
      Effect.gen(function* () {
        if (announced()) return yield* exited();
        const operation = sessionActionPolicy[action._tag].supersedes
          ? readbacks.supersede()
          : readbacks.operation();
        const lane = laneOf(action._tag);
        switch (action._tag) {
          case "prompt":
          case "steer": {
            const exchange = yield* exchangeOf(piExchangeFor(action));
            aborting = undefined;
            promptOperations.add(operation);
            const id = ++submissionId;
            const proof = action.attachments?.length ? undefined : inputFingerprint(action.text);
            const submit = (outcome: PromptSubmission["outcome"], detail?: string) =>
              apply([
                {
                  _tag: "submission",
                  submission: {
                    id,
                    inputFingerprint: proof,
                    outcome,
                    detail,
                    inputId: action.inputId,
                  },
                },
              ]);
            const work = Effect.gen(function* () {
              yield* submit("submitting");
              yield* child.request(exchange, { lane }).pipe(
                Effect.flatMap((disposition) => submit(disposition)),
                Effect.catchTag("PiSessionError", (error) =>
                  submit(
                    error.notSent
                      ? "not_sent"
                      : error.reason === "rejected"
                        ? "rejected"
                        : "uncertain",
                    error.detail,
                  ).pipe(Effect.andThen(Effect.fail(error))),
                ),
              );
              yield* readbacks.refresh("state", operation);
              if (!(yield* publication.state).isStreaming) {
                yield* readbacks.refresh("context");
                yield* readbacks.schedule("stats");
              }
            });
            yield* work.pipe(
              Effect.ensuring(endAbortingPrompt(operation)),
              Effect.forkIn(sessionScope),
              Effect.flatMap(Fiber.join),
            );
            return;
          }
          case "abort": {
            projector.abort();
            const exchange = yield* exchangeOf(piExchangeFor(action));
            const work = Effect.gen(function* () {
              const dispatched = yield* Deferred.make<void>();
              const current = {
                dispatched,
                pendingPrompts: new Set(promptOperations),
                acknowledged: false,
              };
              aborting = current;
              const open = yield* publication.dialogs;
              const native = yield* child
                .request(exchange, { lane, dispatched })
                .pipe(Effect.forkChild);
              yield* Deferred.await(dispatched);
              yield* dialogs.resolveAll("aborted", open);
              yield* Fiber.join(native).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    if (aborting !== current) return;
                    current.acknowledged = true;
                    if (current.pendingPrompts.size === 0) aborting = undefined;
                  }),
                ),
              );
            });
            yield* work.pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join));
            return;
          }
          case "stop": {
            const work = Effect.gen(function* () {
              yield* patchState({ isStopping: true });
              const restored = yield* act({ _tag: "restore_queue" });
              if (restored?._tag !== "queue_restored")
                return yield* new PiSessionError({
                  reason: "protocol",
                  detail: "Pi did not return the cleared queue.",
                });
              const stopError = yield* act({ _tag: "abort" }).pipe(
                Effect.as(undefined),
                Effect.catchTag("PiSessionError", (error) =>
                  Effect.succeed(`Queued input was taken back, but Stop failed: ${error.detail}`),
                ),
              );
              return stopError ? { ...restored, stopError } : restored;
            }).pipe(
              Effect.ensuring(
                Effect.gen(function* () {
                  stopping = false;
                  yield* patchState({ isStopping: false });
                }),
              ),
            );
            return yield* work.pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join));
          }
          case "restore_queue": {
            const messages = yield* child.request(yield* exchangeOf(piExchangeFor(action)), {
              lane,
            });
            return { _tag: "queue_restored", messages };
          }
          case "set_model":
            yield* child.request(yield* exchangeOf(piExchangeFor(action)), { lane });
            yield* readbacks.refresh("state", operation);
            yield* readbacks.refresh("stats");
            return;
          case "set_thinking_level":
          case "set_name":
            yield* child.request(yield* exchangeOf(piExchangeFor(action)), { lane });
            yield* readbacks.refresh("state", operation);
            return;
          case "answer":
            yield* dialogs.answer(action);
            return;
        }
      });

    yield* readbacks.refresh("context");
    initializing = false;
    yield* readbacks.schedule(...initialRefreshes);

    if (spec.lastKnownStats) yield* readbacks.schedule("stats");
    else yield* readbacks.refresh("stats");
    const actionCapacity = makeInboundCapacity(inboundLimits.requests);
    const session: PiSession = {
      spec,
      requestRelease: Effect.sync(() => {
        releaseRequested = true;
      }),
      events,
      act: (action) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.suspend(() => {
            if (stopping && sessionActionPolicy[action._tag].blockedWhileStopping) {
              return Effect.fail(
                refusedUnsent(
                  "rejected",
                  "Stop is in progress. Wait before sending input or changing the queue.",
                ),
              );
            }
            const release = actionCapacity.acquire(
              inputBytes(action),
              sessionActionPolicy[action._tag].priority,
            );
            if (!release)
              return Effect.fail(
                refusedUnsent(
                  "rejected",
                  "Session input capacity is full. Nothing was sent; wait for pending work before trying again.",
                ),
              );
            const stop = action._tag === "stop";
            if (stop) stopping = true;
            return act(action).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  if (stop) stopping = false;
                  release();
                }),
              ),
              Effect.forkIn(sessionScope, { uninterruptible: false }),
              Effect.flatMap((fiber) => restore(Fiber.join(fiber))),
            );
          }),
        ).pipe(redactedErrors),
      state: transaction(() => Effect.map(publication.snapshot, present)).pipe(
        Effect.map((state) => projectState(state)),
      ),
      commands: Effect.suspend(() =>
        announced() ? Effect.fail(exited()) : child.read(piReadbacks.commands),
      ).pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join), redactedErrors),
    };
    return session;
  });

const probe = (
  cwd: string,
  options?: { globalSettingsOnly?: boolean },
): Effect.Effect<ProbeResult, PiSessionError, ChildProcessSpawner> =>
  Effect.gen(function* () {
    const child = yield* PiTransport.spawn(
      ["--no-session", ...(options?.globalSettingsOnly ? ["--no-approve"] : [])],
      cwd,
    );
    const [models, state, commands] = yield* Effect.all([
      child.read(piReadbacks.models),
      child.read(piReadbacks.state),
      child.read(piReadbacks.commands),
    ]).pipe(
      Effect.raceFirst(
        Deferred.await(child.exited).pipe(
          Effect.flatMap(
            (closure) => new PiSessionError({ reason: "spawn", detail: closure.detail }),
          ),
        ),
      ),
    );
    const facts = stateFactsOf(state);
    return {
      commands,
      models,
      defaultModel: facts.model,
      defaultThinkingLevel: facts.thinkingLevel,
    };
  }).pipe(Effect.scoped);

export const PiSessionsLive: Layer.Layer<PiSessions, never, ChildProcessSpawner> = Layer.effect(
  PiSessions,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    const history = yield* makePiHistory();
    return PiSessions.of({
      open: Effect.fn("PiSessions.open")(function* (spec) {
        const scope = yield* Scope.fork(yield* Effect.scope, "sequential");
        let child: PiTransport | undefined;
        return yield* openSession(spec, history, (value) => {
          child = value;
        }).pipe(
          Scope.provide(scope),
          Effect.provideService(ChildProcessSpawner, spawner),
          Effect.catchTag("PiSessionError", (error) =>
            Effect.gen(function* () {
              yield* Scope.close(scope, Exit.void);
              const stopped = child ? yield* child.stopped : true;
              return yield* new PiSessionError({
                ...error,
                ...(stopped ? { startupStopped: true as const } : {}),
              });
            }),
          ),
        );
      }),
      probe: (cwd, options) =>
        probe(cwd, options).pipe(Effect.provideService(ChildProcessSpawner, spawner)),
      history,
    });
  }),
);
