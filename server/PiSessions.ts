/**
 * PiSessions: one running `pi --mode rpc` child per session, behind a small
 * interface in the browser's own vocabulary (SessionEvent / SessionAction).
 *
 * Ownership behind this public seam:
 * - PiTransport: scoped process, framing/capacity, correlation, terminal failure.
 * - This module: generation, atomic snapshot/live publication, readback
 *   freshness, session-owned actions and shutdown announcement.
 * - SessionDialogs: dialog claims and their one terminal resolution, under this module's lock.
 * - PiRecords: protocol translation, not process or publication lifecycle. Its one projection
 *   turns Pi's facts into every Snapshot, a live child's or a saved file's.
 * - PiHistory: saved sessions read without a child, exposed as `history`.
 * The external dependency seam remains ChildProcessSpawner; tests use PiSessions.
 */
import { randomUUID } from "node:crypto";
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Ref,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcessSpawner as Spawner } from "effect/process";

const ChildProcessSpawner = Spawner.ChildProcessSpawner;
type ChildProcessSpawner = Spawner.ChildProcessSpawner;

import { applySessionEvent, isWorking, withLastKnownStats } from "../shared/sessionProjection.ts";
import type {
  ModelChoice,
  PromptSubmission,
  SessionAction,
  SessionActionResult,
  SessionClosure,
  SessionEvent,
  SessionFrame,
  SessionState,
  SessionStats,
  SlashCommand,
  Snapshot,
} from "../shared/wire.ts";
import { type DeliveryOverflow, makeDelivery } from "./BoundedDelivery.ts";
import { projectDisplay, projectSessionEvent, projectSnapshot } from "./DisplayProjection.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { enabledModelPatterns } from "./PiEnv.ts";
import { PiHistory } from "./PiHistory.ts";
import {
  dispositionOf,
  type PiCommand,
  PiProjector,
  type PiRecord,
  type PiTranslation,
  piCommandFor,
  piReadbacks,
  queuedMessagesOf,
  type RefreshKind,
  sessionArgs,
  stateFactsOf,
} from "./PiRecords.ts";
import { type PiLane, PiSessionError, PiTransport } from "./PiTransport.ts";
import { makeSessionDialogs } from "./SessionDialogs.ts";
import { RunLedger } from "./Subagents.ts";

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
}

export interface ProbeResult {
  readonly commands: ReadonlyArray<SlashCommand>;
  /** In Pi's order, each with the efforts Pi accepts for it and whether Pi's `enabledModels` scopes it in. */
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
     * `globalSettingsOnly` ignores the directory's project resources, and scopes no model in.
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
  commands: {
    priority: false,
    supersedes: false,
    blockedWhileStopping: false,
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

const commandOf = (translation: PiTranslation): Effect.Effect<PiCommand, PiSessionError> =>
  "rejected" in translation
    ? Effect.fail(new PiSessionError({ reason: "rejected", detail: translation.rejected }))
    : Effect.succeed(translation.command);

// The saved-history types `history` speaks in.
export type { HistoryLocation, PiHistory } from "./PiHistory.ts";
// Preserve the public configuration/error imports; transport details stay internal.
export { PiRequestTimeoutMs, PiSessionError } from "./PiTransport.ts";

/** Bounded recovery for dialogs whose extension-owned cancellation is invisible over RPC. */
export const PiDialogRecoveryMs = Context.Reference<number>("piano/PiDialogRecoveryMs", {
  defaultValue: () => 10 * 60_000,
});

/** Retained state shows nothing Pi could still continue on its own or that awaits an answer. */
const settled = ({ state, dialogs }: Snapshot) =>
  dialogs.length === 0 &&
  !isWorking(state) &&
  !state.isStopping &&
  !state.queuedMessages?.length &&
  state.dialogResolution?.delivery !== "pending" &&
  state.dialogResolution?.delivery !== "uncertain" &&
  state.submission?.outcome !== "submitting" &&
  state.submission?.outcome !== "uncertain";

const openSession = (spec: PiSessionSpec) =>
  Effect.gen(function* () {
    const child = yield* PiTransport.spawn(sessionArgs(spec), spec.cwd);
    const sessionScope = yield* Effect.scope;
    // A generation belongs to this open, never to a browser or subscription.
    const generation = randomUUID();
    const recoveryMs = yield* PiDialogRecoveryMs;

    // Ready check and initial transcript. Both race the child exiting early.
    const initial = yield* Effect.all([
      child.read(piReadbacks.state),
      child.read(piReadbacks.messages),
    ]).pipe(
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
    const projector = new PiProjector({ generation, recoveryMs });
    const opened = projector.snapshot({ source: "live", state: initial[0], messages: initial[1] });
    if (opened.state.sessionId !== spec.sessionId)
      return yield* new PiSessionError({
        reason: "protocol",
        detail:
          "Pi opened a different session ID. History was not merged; check the saved reference.",
      });
    // Everything a subscriber's snapshot holds except host observations, kept by the shared fold.
    const snapshotRef = yield* Ref.make<Snapshot>({
      ...opened,
      state: withLastKnownStats(opened.state, spec.lastKnownStats),
      tools: [],
    });
    const stateOf = Effect.map(Ref.get(snapshotRef), (snapshot) => snapshot.state);
    const dialogsOf = Effect.map(Ref.get(snapshotRef), (snapshot) => snapshot.dialogs);
    const subscribers = new Set<Effect.Success<ReturnType<typeof makeDelivery<SessionFrame>>>>();
    let sequence = 0;
    const cursor = () => ({ cwd: spec.cwd, sessionId: spec.sessionId, generation, sequence });
    // Publication owner: this lock covers projector correlation, snapshot fold,
    // sequence assignment and subscriber attachment. Never await a consumer here.
    // All publish callers hold the lock; transport/readbacks wait outside it.
    const publish = Effect.fnUntraced(function* (event: SessionEvent) {
      yield* Ref.update(snapshotRef, (snapshot) => applySessionEvent(snapshot, event));
      sequence++;
      const frame: SessionFrame = { ...projectSessionEvent(event), cursor: cursor() };
      for (const subscriber of subscribers) yield* subscriber.offer(frame);
    });
    const lock = yield* Semaphore.make(1);
    const metadataFields = ["model", "thinkingLevel", "sessionName", "sessionFile"] as const;
    const factVersions = { model: 0, thinkingLevel: 0, sessionName: 0, sessionFile: 0 };
    let statsVersion = 0;
    let contextVersion = 0;
    let operationVersion = 0;
    let submissionId = 0;
    let announced = false;
    let processedVersion = 0;
    // Cancellation owner: operation tokens fence late abort/readback results.
    // Work belongs to sessionScope, not the lifetime of the requesting browser.
    const promptOperations = new Set<number>();
    let aborting:
      | { dispatched: Deferred.Deferred<void>; pendingPrompts: Set<number>; acknowledged: boolean }
      | undefined;

    /** Fold and publish, atomically with respect to snapshots. */
    const apply = (events: ReadonlyArray<SessionEvent> | (() => ReadonlyArray<SessionEvent>)) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          for (const event of typeof events === "function" ? events() : events)
            yield* publish(event);
        }),
      );

    /** Merge state fields; callers hold the snapshot lock. */
    const mergeState = Effect.fnUntraced(function* (patch: Partial<SessionState>) {
      const current = yield* stateOf;
      const next = { ...current, ...patch };
      if (isWorking(next) || next.model !== current.model) next.contextIsLastKnown = true;
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      for (const field of metadataFields)
        if (next[field] !== current[field]) factVersions[field] += 1;
      yield* publish({ _tag: "state", state: next });
    });
    const patchState = (patch: Partial<SessionState> | (() => Partial<SessionState>)) =>
      Semaphore.withPermits(
        lock,
        1,
      )(Effect.suspend(() => mergeState(typeof patch === "function" ? patch() : patch)));

    // Dialog claims share publication's lock: claim under it, write to Pi outside it.
    const dialogs = makeSessionDialogs({
      generation,
      scope: sessionScope,
      // Every dialog response, an answer or a cancellation, rides the answer's lane.
      write: (command) => child.write(command, { lane: laneOf("answer") }),
      publication: {
        locked: Semaphore.withPermits(lock, 1),
        publish,
        mergeState,
        state: stateOf,
        dialogs: dialogsOf,
        announced: () => announced,
      },
      abortInProgress: () => aborting?.dispatched,
    });

    const endAbortingPrompt = (operation: number) =>
      Effect.sync(() => {
        promptOperations.delete(operation);
        aborting?.pendingPrompts.delete(operation);
        if (aborting?.acknowledged && aborting.pendingPrompts.size === 0) aborting = undefined;
      });

    /** Run usage from entries Pi appended since the last read. Only the stats worker reads. */
    const ledger = new RunLedger();
    const readRuns = Effect.gen(function* () {
      const entries = (since?: string) => child.read(piReadbacks.entries(since));
      const since = ledger.since;
      // A session that no longer holds the last entry read is counted afresh.
      ledger.add(
        yield* entries(since).pipe(
          Effect.catchTag("PiSessionError", (error) =>
            since
              ? Effect.sync(() => ledger.reset()).pipe(Effect.andThen(entries()))
              : Effect.fail(error),
          ),
        ),
      );
      return ledger.usage;
    });

    /** Canonical projected context and billed cost from Pi, not partial response usage.
     * Refresh at persisted boundaries, never per token/delta. Best effort.
     */
    const refreshStats = Effect.gen(function* () {
      const version = ++statsVersion;
      const modelVersion = factVersions.model;
      const outputVersion = child.observationVersion();
      yield* patchState({ contextIsLastKnown: true });
      yield* Effect.gen(function* () {
        const stats = yield* child.read(piReadbacks.stats);
        const statsUpdatedAt = yield* Clock.currentTimeMillis;
        const current = () =>
          version === statsVersion && modelVersion === factVersions.model && !announced;
        yield* patchState(() =>
          current()
            ? {
                ...stats,
                statsUpdatedAt,
                contextIsLastKnown: outputVersion !== child.observationVersion(),
                statsRefreshError: undefined,
              }
            : {},
        );
        // Pi's figures above neither wait on nor fail with the Runs' entries; a failed read keeps
        // the last count, and the next refresh continues from the last entry read.
        const subagents = yield* readRuns.pipe(Effect.option);
        if (subagents._tag === "Some")
          yield* patchState(() => (current() ? { subagents: subagents.value } : {}));
      }).pipe(
        Effect.catchTag("PiSessionError", (error) =>
          patchState(() =>
            announced || version !== statsVersion
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
    const refreshState = Effect.fn("PiSessions.refreshState")(
      function* (operation: number) {
        if (operation !== operationVersion) return;
        const versions = { ...factVersions };
        const raw = yield* child.read(piReadbacks.state);
        yield* patchState(() => {
          if (operation !== operationVersion || announced) return {};
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
            announced || operation !== operationVersion
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
      for (let attempt = 0; attempt < 3; attempt++) {
        const outputVersion = child.observationVersion();
        const messages = yield* child.read(piReadbacks.messages);
        if (version !== contextVersion || announced) return;
        const applied = yield* Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            if (
              version !== contextVersion ||
              outputVersion !== child.observationVersion() ||
              announced
            )
              return false;
            yield* publish({ _tag: "context", messages: projector.history(messages) });
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

    // At most one worker per readback kind. Never await RPC inspection from the
    // record consumer: Pi may need a later dialog answered before replying.
    const refreshers: Record<RefreshKind, Effect.Effect<void>> = {
      stats: refreshStats,
      context: refreshContext,
      state: Effect.suspend(() => refreshState(operationVersion)),
    };
    const refreshing = new Set<RefreshKind>();
    const requested = new Set<RefreshKind>();
    const scheduleRefresh = Effect.fnUntraced(function* (...kinds: ReadonlyArray<RefreshKind>) {
      for (const kind of kinds) {
        requested.add(kind);
        if (refreshing.has(kind)) continue;
        refreshing.add(kind);
        yield* Effect.gen(function* () {
          while (requested.delete(kind) && !announced) yield* refreshers[kind];
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              refreshing.delete(kind);
            }),
          ),
          Effect.forkIn(sessionScope),
        );
      }
    });

    const onRecord = ({ record, receivedAt }: { record: PiRecord; receivedAt: number }) =>
      Effect.gen(function* () {
        if (announced) return;
        // Translate under the lock too: a history readback replaces the projector's correlation facts.
        const { refresh, dialog } = yield* Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const projected = projector.record(record, receivedAt);
            if (projected.dialog) yield* dialogs.opened(projected.dialog);
            if (projected.state) yield* mergeState(projected.state);
            for (const event of projected.events) yield* publish(event);
            return projected;
          }),
        );
        yield* scheduleRefresh(...refresh);
        if (dialog) yield* dialogs.watch(dialog);
      });

    const recordsDrained = yield* Deferred.make<void>();
    yield* child.records.pipe(
      Stream.runForEach((item) =>
        onRecord(item).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              processedVersion++;
            }),
          ),
        ),
      ),
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
        if (announced) return Effect.void;
        announced = true;
        return Effect.gen(function* () {
          const final = yield* closure;
          const submission = (yield* stateOf).submission;
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
          Ref.get(snapshotRef),
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

    const currentState = Effect.gen(function* () {
      const snapshot = yield* Ref.get(snapshotRef);
      return {
        ...snapshot.state,
        isQuiescent:
          !announced &&
          !child.hasPendingWork() &&
          processedVersion === child.observationVersion() &&
          refreshing.size === 0 &&
          promptOperations.size === 0 &&
          settled(snapshot),
      };
    });

    const events: Stream.Stream<SessionFrame, DeliveryOverflow> = Stream.unwrap(
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const sub = yield* makeDelivery<SessionFrame>();
          subscribers.add(sub);
          const snapshot: Snapshot = {
            ...(yield* Ref.get(snapshotRef)),
            state: yield* currentState,
          };
          return Stream.make<[SessionFrame]>({
            _tag: "snapshot",
            snapshot: projectSnapshot(snapshot),
            cursor: cursor(),
          }).pipe(
            Stream.concat(snapshot.state.closure ? Stream.empty : sub.stream),
            Stream.takeUntil((e) => e._tag === "closed"),
            Stream.ensuring(
              Effect.sync(() => {
                subscribers.delete(sub);
              }),
            ),
          );
        }),
      ),
    );

    let stopping = false;
    const act = (
      action: SessionAction,
    ): Effect.Effect<SessionActionResult | undefined, PiSessionError> =>
      Effect.gen(function* () {
        if (announced)
          return yield* new PiSessionError({
            reason: "exited",
            detail:
              "Pi has stopped. Reopen history before sending new input; interrupted operations do not resume.",
          });
        // Answer/abort/queue restoration do not supersede the command whose
        // dialog they unblock. Keep its subsequent model/effort readback valid.
        const operation = sessionActionPolicy[action._tag].supersedes
          ? ++operationVersion
          : operationVersion;
        const lane = laneOf(action._tag);
        switch (action._tag) {
          case "commands":
            return { _tag: "commands", commands: yield* child.read(piReadbacks.commands) };
          case "prompt":
          case "steer": {
            const command = yield* commandOf(piCommandFor(action));
            // Pi's clear_queue only returns text. Do not offer a lossy image queue.
            if (action.attachments?.length && isWorking(yield* stateOf))
              return yield* new PiSessionError({
                reason: "rejected",
                detail: "Wait for Pi to finish before sending images.",
              });
            // Explicit new input starts a new operation boundary. An older abort's
            // acknowledgement must never cancel its dialogs or clear its activity.
            aborting = undefined;
            promptOperations.add(operation);
            const id = ++submissionId;
            const submit = (outcome: PromptSubmission["outcome"], detail?: string) =>
              apply([{ _tag: "submission", submission: { id, outcome, detail } }]);
            // Once dispatched, acknowledgement tracking belongs to the session,
            // not the browser/caller that may disconnect while Pi handles input.
            const work = Effect.gen(function* () {
              yield* submit("submitting");
              yield* child.request(command, { lane }).pipe(
                Effect.flatMap((data) => {
                  const disposition = dispositionOf(data);
                  if (!disposition) {
                    return Effect.fail(
                      new PiSessionError({
                        reason: "protocol",
                        detail:
                          "Pi acknowledged the input without a recognized disposition. Inspect the session before sending again.",
                      }),
                    );
                  }
                  return submit(disposition);
                }),
                Effect.catchTag("PiSessionError", (error) =>
                  submit(error.reason === "rejected" ? "rejected" : "uncertain", error.detail).pipe(
                    Effect.andThen(Effect.fail(error)),
                  ),
                ),
              );
              yield* refreshState(operation);
              // Handled commands may edit context without a run/compaction event.
              if (!(yield* stateOf).isStreaming) {
                yield* refreshContext;
                yield* scheduleRefresh("stats");
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
            const command = yield* commandOf(piCommandFor(action));
            const work = Effect.gen(function* () {
              const dispatched = yield* Deferred.make<void>();
              const current = {
                dispatched,
                pendingPrompts: new Set(promptOperations),
                acknowledged: false,
              };
              aborting = current;
              const open = yield* dialogsOf;
              const native = yield* child
                .request(command, { lane, dispatched })
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
            const messages = queuedMessagesOf(
              yield* child.request(yield* commandOf(piCommandFor(action)), { lane }),
            );
            if (!messages)
              return yield* new PiSessionError({
                reason: "protocol",
                detail: "Pi returned an invalid cleared queue.",
              });
            return { _tag: "queue_restored", messages };
          }
          case "set_model":
            yield* child.request(yield* commandOf(piCommandFor(action)), { lane });
            yield* refreshState(operation);
            yield* refreshStats;
            return;
          case "set_thinking_level":
          case "set_name":
            yield* child.request(yield* commandOf(piCommandFor(action)), { lane });
            yield* refreshState(operation);
            return;
          case "answer":
            yield* dialogs.answer(action);
            return;
        }
      });

    // Cached values must be available without waiting for a slow/failed readback.
    // Uncached sessions retain the initial statistics readiness contract.
    if (spec.lastKnownStats) yield* scheduleRefresh("stats");
    else yield* refreshStats;
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
        ).pipe(
          Effect.map(projectDisplay),
          Effect.mapError(
            (error) =>
              new PiSessionError({ reason: error.reason, detail: projectDisplay(error.detail) }),
          ),
        ),
      state: Semaphore.withPermits(lock, 1)(currentState).pipe(Effect.map(projectDisplay)),
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
      child.read(piReadbacks.models(options?.globalSettingsOnly ? [] : enabledModelPatterns(cwd))),
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
      history: PiHistory,
    });
  }),
);
