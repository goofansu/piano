/**
 * PiSessions: one running `pi --mode rpc` child per session, behind a small
 * interface in the browser's own vocabulary (SessionEvent / SessionAction).
 *
 * Ownership behind this public seam:
 * - PiTransport: scoped process, framing/capacity, correlation, terminal failure.
 * - This module: generation, the projector, session-owned actions and shutdown.
 * - SessionPublication: the snapshot, its lock, sequence and cursor, and atomic snapshot/live
 *   subscription.
 * - SessionReadbacks: readback workers and freshness, landing through the publication.
 * - SessionRecordProgress: received and processed records, open messages, and when Pi's context
 *   may replace projected history.
 * - SessionDialogs: dialog claims and their one terminal resolution, under the publication lock.
 * - PiRecords: protocol translation, not process or publication lifecycle. Its one projection
 *   turns Pi's facts into every Snapshot, a live child's or a saved file's.
 * - PiHistory: saved sessions read without a child, exposed as `history`.
 * The external dependency seam remains ChildProcessSpawner; tests use PiSessions.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Cause, Context, Deferred, Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { ChildProcessSpawner as Spawner } from "effect/process";

const ChildProcessSpawner = Spawner.ChildProcessSpawner;
type ChildProcessSpawner = Spawner.ChildProcessSpawner;

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
import { projectDisplay } from "./DisplayProjection.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { makePiHistory, type PiHistory, savedEntries } from "./PiHistory.ts";
import {
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
import { type PiLane, PiSessionError, PiTransport } from "./PiTransport.ts";
import { makeSessionDialogs } from "./SessionDialogs.ts";
import { makeSessionPublication } from "./SessionPublication.ts";
import { makeSessionReadbacks } from "./SessionReadbacks.ts";
import { makeSessionRecordProgress } from "./SessionRecordProgress.ts";

// ── Interface ────────────────────────────────────────────────────────────────

export interface PiSessionSpec {
  readonly cwd: string;
  readonly sessionId: string;
  /** Existing Pi file, including an old alias-based reference. Never copied or moved. */
  readonly sessionFile?: string;
  /** "provider/id" passed as --model */
  readonly model?: string;
  /** Passed as --thinking */
  readonly thinkingLevel?: string;
  /** Passed as --name for a session without history; Pi's saved name wins once `sessionFile` exists. */
  readonly name?: string;
  /** The dispatching session, passed to Piano's extension to record in a new session's history. */
  readonly dispatchedFrom?: string;
  /** Seed only display statistics while Pi's authoritative readback is pending. */
  readonly lastKnownStats?: SessionStats;
}

export interface PiSession {
  readonly spec: PiSessionSpec;
  /** Atomic snapshot/cursor first, then contiguous live frames until closed.
   * A subscriber exceeding 256 queued frames / 8 MiB fails DeliveryOverflow;
   * attach again for a current snapshot, never replay commands or old deltas. */
  readonly events: Stream.Stream<SessionFrame, DeliveryOverflow>;
  /** Apply a browser action; command results belong only to the requesting caller. */
  readonly act: (
    action: SessionAction,
  ) => Effect.Effect<SessionActionResult | undefined, PiSessionError>;
  /** Current state without subscribing. */
  readonly state: Effect.Effect<SessionState>;
  /** Pi's slash commands for this session, in invocation precedence. A query: it starts no
   * operation and changes nothing in Pi. */
  readonly commands: Effect.Effect<ReadonlyArray<SlashCommand>, PiSessionError>;
}

export interface ProbeResult {
  readonly commands: ReadonlyArray<SlashCommand>;
  /** In Pi's order, each with the efforts Pi accepts for it. */
  readonly models: ReadonlyArray<ModelChoice>;
  readonly defaultModel?: string;
  readonly defaultThinkingLevel?: string;
}

export class PiSessions extends Context.Service<
  PiSessions,
  {
    /** Spawn Pi for a session. The child lives as long as the calling Scope. */
    readonly open: (spec: PiSessionSpec) => Effect.Effect<PiSession, PiSessionError, Scope.Scope>;
    /**
     * One-shot `pi --mode rpc --no-session`: available models, slash commands and Pi's default.
     * `globalSettingsOnly` ignores the directory's project resources.
     */
    readonly probe: (
      cwd: string,
      options?: { globalSettingsOnly?: boolean },
    ) => Effect.Effect<ProbeResult, PiSessionError>;
    /** Saved sessions without starting Pi: locate a file across checkout spellings, list a
     * directory's session IDs, peek a file as the Snapshot `open` would start from, and export its
     * active branch. Never moves, merges or repairs history (INV-01). */
    readonly history: PiHistory;
  }
>()("piano/PiSessions") {}

/** How the server admits and sequences one kind of {@link SessionAction}. */
export interface SessionActionPolicy {
  /**
   * Admitted ahead of ordinary work when inbound capacity is saturated, so a
   * saturated session can still be answered, aborted, stopped or have its queue restored.
   * The one decision of the control lane: the action, and the Pi commands it sends, ride it.
   */
  readonly priority: boolean;
  /**
   * Starts a new operation, invalidating readbacks owed to earlier ones. Answer, abort and
   * queue restoration do not: they unblock the command whose dialog is open.
   */
  readonly supersedes: boolean;
  /** Rejected while Stop is in progress; delaying it could start new work once Stop completes. */
  readonly blockedWhileStopping: boolean;
  /** Requires the session's checkout to still exist. Abort and Stop must work without one. */
  readonly needsCheckout: boolean;
  /** Counts as user activity on the session reference, recorded before admission. */
  readonly activity: boolean;
}

/**
 * Every action kind's admission policy. Exhaustive by type, so a new
 * SessionAction variant cannot be sent until it is classified here.
 */
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

// ── Implementation ───────────────────────────────────────────────────────────

/** The transport lane an action's Pi commands occupy, from its policy alone. */
const laneOf = (tag: SessionAction["_tag"]): PiLane =>
  sessionActionPolicy[tag].priority ? "control" : "ordinary";

const exchangeOf = <A>(
  translation: PiExchange<A> | PiRejection,
): Effect.Effect<PiExchange<A>, PiSessionError> =>
  "rejected" in translation
    ? Effect.fail(new PiSessionError({ reason: "rejected", detail: translation.rejected }))
    : Effect.succeed(translation);

// The saved-history types `history` speaks in.
export type { HistoryLocation, PiHistory } from "./PiHistory.ts";
// Preserve the public configuration/error imports; transport details stay internal.
export { PiRequestTimeoutMs, PiSessionError } from "./PiTransport.ts";

/** Bounded recovery for dialogs whose extension-owned cancellation is invisible over RPC. */
export const PiDialogRecoveryMs = Context.Reference<number>("piano/PiDialogRecoveryMs", {
  defaultValue: () => 10 * 60_000,
});

/** Retained state shows nothing Pi could still continue on its own or that awaits an answer. */
const settled = (snapshot: Snapshot) => liveActivityOf(snapshot)._tag === "idle";

/** What leaves the session seam, results and error details alike, is display-projected. */
const displayed = <A>(effect: Effect.Effect<A, PiSessionError>) =>
  effect.pipe(
    Effect.map(projectDisplay),
    Effect.mapError(
      (error) => new PiSessionError({ reason: error.reason, detail: projectDisplay(error.detail) }),
    ),
  );

const replacedDetail =
  "Pi switched this process to another session, so Piano closed it. Reopen this session to continue; no input was resent.";

const openSession = (spec: PiSessionSpec) =>
  Effect.gen(function* () {
    const child = yield* PiTransport.spawn(sessionArgs(spec), spec.cwd);
    const sessionScope = yield* Effect.scope;
    // A generation belongs to this open, never to a browser or subscription.
    const generation = randomUUID();
    const recoveryMs = yield* PiDialogRecoveryMs;

    // Every entry so far, for Runs' spend and the dispatching session. Pi's get_entries answers in
    // one RPC line, which a long compacted history pushes past the line limit, closing the child.
    // Once Pi has saved the session, its file is read as `history` reads it; before that, Pi holds
    // no conversation and its reply is small.
    const allEntries = (file: string | undefined) =>
      file && existsSync(file)
        ? savedEntries(file, spec.sessionId)
        : child.read(piReadbacks.entries());

    // Ready check, then entries from the file Pi opened, racing the child exiting early. The
    // transcript is not read here: the context refresh below reads it once, after records are
    // drained. Entries are best effort, as usage readbacks are: a failed read opens without Runs'
    // spend or the dispatching session, and usage readbacks then count every entry.
    const [state, entries] = yield* child.read(piReadbacks.state).pipe(
      Effect.flatMap((state) =>
        allEntries(state.sessionFile).pipe(
          Effect.catchTag("PiSessionError", () => Effect.succeed<ReadonlyArray<unknown>>([])),
          Effect.map((entries) => [state, entries] as const),
        ),
      ),
      // Readiness failure wins too: race waits for a first success and would
      // suppress a deadline until a still-live child eventually exits.
      Effect.raceFirst(
        Deferred.await(child.exited).pipe(
          Effect.flatMap(
            (closure) => new PiSessionError({ reason: "spawn", detail: closure.detail }),
          ),
        ),
      ),
    );
    const projector = new PiProjector({ generation });
    // Readiness is not an event boundary: Pi's history then can overlap buffered records or
    // contain a finalized message whose message_end is still awaiting an extension. Project
    // records onto an empty provisional transcript; the context refresh reconciles it before
    // exposing it.
    const opened = projector.snapshot({ source: "live", state, messages: [], entries });
    if (opened.state.sessionId !== spec.sessionId)
      return yield* new PiSessionError({
        reason: "protocol",
        detail:
          "Pi opened a different session ID. History was not merged; check the saved reference.",
      });
    // Publication owner: its lock covers projector correlation, snapshot fold, sequence
    // assignment and subscriber attachment. Transport and readbacks wait outside it.
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
    // Cancellation owner: operation tokens fence late abort/readback results.
    // Work belongs to sessionScope, not the lifetime of the requesting browser.
    const promptOperations = new Set<number>();
    let aborting:
      | {
          dispatched: Deferred.Deferred<void>;
          pendingPrompts: Set<number>;
          acknowledged: boolean;
        }
      | undefined;

    // Dialog claims share publication's lock: claim under it, write to Pi outside it.
    const dialogs = makeSessionDialogs({
      generation,
      recoveryMs,
      scope: sessionScope,
      // Every dialog response, an answer or a cancellation, rides the answer's lane.
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

    // A hosted child never changes identity (INV-02, INV-07). Piano's extension cancels an
    // extension's newSession/switchSession/fork; should Pi replace the session anyway, nothing it
    // reports may land under this ID or checkout, so the child is closed before the readback is
    // published. Both sessions' history stays where Pi saved it; reopening resumes this one.
    const readState = Effect.gen(function* () {
      const state = yield* child.read(piReadbacks.state);
      if (state.sessionId === spec.sessionId) return state;
      yield* child.fail(replacedDetail);
      return yield* new PiSessionError({ reason: "protocol", detail: replacedDetail });
    });

    // Readbacks land through publication's lock; Pi is read outside it.
    const readbacks = makeSessionReadbacks({
      scope: sessionScope,
      read: child.read,
      readState,
      progress,
      context: (messages) => ({ _tag: "context", messages: projector.history(messages) }),
      publication,
      entries,
      allEntries: Effect.flatMap(publication.state, (current) => allEntries(current.sessionFile)),
    });

    const onRecord = Effect.fnUntraced(function* ({
      record,
      receivedAt,
    }: {
      record: PiRecord;
      receivedAt: number;
    }) {
      if (announced()) return;
      // Translate under the lock too: a history readback replaces the projector's correlation facts.
      const { refresh, dialog } = yield* transaction((tx) =>
        Effect.gen(function* () {
          progress.project(record);
          const projected = projector.record(record, receivedAt);
          if (projected.state) yield* tx.mergeState(projected.state);
          for (const event of projected.events) yield* tx.publish(event);
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

    // Shutdown owner: transport settles callers and ends records; this module
    // drains projected records before publishing exactly one terminal snapshot.
    // Subscribers learn exactly once that Pi is gone: from the child's own exit (a crash),
    // or from this scope closing (a deliberate release), whichever comes first. The
    // finalizer is registered after the child's, so it runs before Pi is shut down.
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
    // Release is "during work" when Pi still held work it could continue or that awaited an
    // answer. Readback workers and prompt fibers are already interrupted by now, so judge from
    // retained state and transport uncertainty, never from those fibers.
    yield* Effect.addFinalizer(() =>
      announceClosed(
        Effect.map(
          publication.snapshot,
          (snapshot): SessionClosure =>
            settled(snapshot) && !child.hasPendingWork()
              ? { _tag: "released", detail: "Pi was released" }
              : { _tag: "released_during_work", detail: "Pi was released during work" },
        ),
      ),
    );
    // Preserve already-read output before announcing an exit. The record-loop
    // finalizer only signals completion; it never waits for a later child finalizer.
    yield* Deferred.await(child.exited).pipe(
      Effect.flatMap((closure) =>
        Deferred.await(recordsDrained).pipe(
          Effect.andThen(announceClosed(Effect.succeed(closure))),
        ),
      ),
      Effect.forkScoped,
    );

    // A subscriber's snapshot and `state` add the host's quiescence to the retained state.
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
      new PiSessionError({
        reason: "exited",
        detail:
          "Pi has stopped. Reopen history before sending new input; interrupted operations do not resume.",
      });
    const act = (
      action: SessionAction,
    ): Effect.Effect<SessionActionResult | undefined, PiSessionError> =>
      Effect.gen(function* () {
        if (announced()) return yield* exited();
        // Answer/abort/queue restoration do not supersede the command whose
        // dialog they unblock. Keep its subsequent model/effort readback valid.
        const operation = sessionActionPolicy[action._tag].supersedes
          ? readbacks.supersede()
          : readbacks.operation();
        const lane = laneOf(action._tag);
        switch (action._tag) {
          case "prompt":
          case "steer": {
            const exchange = yield* exchangeOf(piExchangeFor(action));
            // Explicit new input starts a new operation boundary. An older abort's
            // acknowledgement must never cancel its dialogs or clear its activity.
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
            // Once dispatched, acknowledgement tracking belongs to the session,
            // not the browser/caller that may disconnect while Pi handles input.
            const work = Effect.gen(function* () {
              yield* submit("submitting");
              yield* child.request(exchange, { lane }).pipe(
                Effect.flatMap((disposition) => submit(disposition)),
                Effect.catchTag("PiSessionError", (error) =>
                  submit(error.reason === "rejected" ? "rejected" : "uncertain", error.detail).pipe(
                    Effect.andThen(Effect.fail(error)),
                  ),
                ),
              );
              yield* readbacks.refresh("state", operation);
              // Handled commands may edit context without a run/compaction event.
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
              // Order abort before releasing an extension that may continue work.
              // This waits for the transport attempt, NOT Pi's acknowledgement.
              yield* Deferred.await(dispatched);
              // Cancellation must not wait for native abort's acknowledgement:
              // idle extension commands often have no signal for it to cancel.
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
            stopping = true;
            // Pi has no compound RPC. Take its authoritative queue before abort
            // can drain steering at a tool boundary (INV-01/03). Keep ownership
            // in the session if the requesting browser disconnects mid-operation.
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
              // Return partial failure with the text: session events may already
              // have ended at `closed`, so a notice there could be lost.
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

    // Never wait for a dialog or a running message to finish readiness. A bounded, explicit
    // projection error leaves those controls available; a later message/settled boundary retries.
    yield* readbacks.refresh("context");
    initializing = false;
    yield* readbacks.schedule(...initialRefreshes);

    // Cached statistics are shown without waiting for a slow or failed usage readback; open has
    // still waited for the one entries read above. Uncached sessions keep the initial statistics
    // readiness contract.
    if (spec.lastKnownStats) yield* readbacks.schedule("stats");
    else yield* readbacks.refresh("stats");
    const actionCapacity = makeInboundCapacity(inboundLimits.requests);
    const session: PiSession = {
      spec,
      events,
      act: (action) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.suspend(() => {
            // Reject rather than delay input: delayed submissions could accidentally
            // start new work as soon as Stop completes. Answers must remain available.
            if (stopping && sessionActionPolicy[action._tag].blockedWhileStopping) {
              return Effect.fail(
                new PiSessionError({
                  reason: "rejected",
                  detail: "Stop is in progress. Wait before sending input or changing the queue.",
                }),
              );
            }
            const release = actionCapacity.acquire(
              Buffer.byteLength(JSON.stringify(action)),
              sessionActionPolicy[action._tag].priority,
            );
            if (!release)
              return Effect.fail(
                new PiSessionError({
                  reason: "rejected",
                  detail:
                    "Session input capacity is full. Nothing was sent; wait for pending work before trying again.",
                }),
              );
            // Admission follows session-owned work, not the lifetime of a browser join.
            return act(action).pipe(
              Effect.ensuring(Effect.sync(release)),
              Effect.forkIn(sessionScope, { uninterruptible: false }),
              Effect.flatMap((fiber) => restore(Fiber.join(fiber))),
            );
          }),
        ).pipe(displayed),
      state: transaction(() => Effect.map(publication.snapshot, present)).pipe(
        Effect.map(projectDisplay),
      ),
      // The read belongs to the session, not the requester: an abandoned request leaves no
      // half-written command on Pi's input.
      commands: Effect.suspend(() =>
        announced() ? Effect.fail(exited()) : child.read(piReadbacks.commands),
      ).pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join), displayed),
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
    return PiSessions.of({
      open: (spec) => openSession(spec).pipe(Effect.provideService(ChildProcessSpawner, spawner)),
      probe: (cwd, options) =>
        probe(cwd, options).pipe(Effect.provideService(ChildProcessSpawner, spawner)),
      history: makePiHistory(),
    });
  }),
);
