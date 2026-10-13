/**
 * PiSessions: one running `pi --mode rpc` child per session, behind a small
 * interface in the browser's own vocabulary (SessionEvent / SessionAction).
 *
 * Ownership behind this public seam:
 * - PiTransport: scoped process, framing/capacity, correlation, terminal failure.
 * - This module: generation, atomic snapshot/live publication, dialog claims,
 *   readback freshness, session-owned actions and shutdown announcement.
 * - PiRecords: protocol translation, not process or publication lifecycle.
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
  Dialog,
  DialogResolution,
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
import {
  dialogCancellation,
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
import { PiSessionError, PiTransport } from "./PiTransport.ts";
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
  }
>()("piano/PiSessions") {}

/** How the server admits and sequences one kind of {@link SessionAction}. */
export interface SessionActionPolicy {
  /**
   * Admitted ahead of ordinary work when inbound capacity is saturated, so a
   * saturated session can still be answered, aborted, stopped or have its queue restored.
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

const commandOf = (translation: PiTranslation): Effect.Effect<PiCommand, PiSessionError> =>
  "rejected" in translation
    ? Effect.fail(new PiSessionError({ reason: "rejected", detail: translation.rejected }))
    : Effect.succeed(translation.command);

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
    const opened = projector.state(initial[0]);
    if (opened.sessionId !== spec.sessionId)
      return yield* new PiSessionError({
        reason: "protocol",
        detail:
          "Pi opened a different session ID. History was not merged; check the saved reference.",
      });
    // Everything a subscriber's snapshot holds except host observations, kept by the shared fold.
    const snapshotRef = yield* Ref.make<Snapshot>({
      state: withLastKnownStats(opened, spec.lastKnownStats),
      messages: projector.history(initial[1], "m"),
      dialogs: [],
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
    // Dialog lifecycle stays with publication: claim/removal, deadline wakeup and
    // resolution frames must share one atomic snapshot boundary. Transport is
    // attempted only after the claim; no transport acknowledgement reopens it.
    const dialogClosed = new Map<string, Deferred.Deferred<void>>();
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

    /** All terminal paths compete under the snapshot lock, before any transport yield. */
    const resolveDialog = Effect.fn("PiSessions.resolveDialog")(function* (
      dialog: Dialog,
      reason: DialogResolution["reason"],
      answer?: PiCommand,
    ) {
      const resolution = yield* Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          if (!(yield* dialogsOf).some((open) => open.id === dialog.id)) return;
          const now = yield* Clock.currentTimeMillis;
          if ((reason === "answered" || reason === "cancelled") && now >= dialog.deadlineAt) {
            reason = dialog.deadlineKind === "pi-timeout" ? "expired" : "recovery";
          }
          const send = reason !== "expired" && reason !== "exited";
          const detail =
            reason === "expired"
              ? "Estimated Pi deadline elapsed. Pi owns the actual timeout; no closure acknowledgement is available."
              : reason === "exited"
                ? "Pi stopped before this dialog was answered. No response sent."
                : reason === "recovery"
                  ? "Host recovery deadline elapsed; cancelling an unconfirmed dialog."
                  : reason === "aborted"
                    ? "Abort current: cancelling this dialog. Pending queue is not cleared."
                    : "Response claimed locally; waiting for transport delivery.";
          const resolution: DialogResolution = {
            id: dialog.id,
            generation,
            reason,
            delivery: send ? "pending" : "not-sent",
            detail,
          };
          const closed = dialogClosed.get(dialog.id);
          if (closed) yield* Deferred.succeed(closed, undefined);
          dialogClosed.delete(dialog.id);
          yield* publish({ _tag: "dialog_resolved", resolution });
          yield* publish({
            _tag: "state",
            state: { ...(yield* stateOf), dialogResolution: resolution },
          });
          return resolution;
        }),
      );
      if (!resolution || resolution.delivery === "not-sent") return resolution;
      const result = yield* child
        .write(resolution.reason === "answered" && answer ? answer : dialogCancellation(dialog.id))
        .pipe(Effect.result);
      const final: DialogResolution = {
        ...resolution,
        delivery: result._tag === "Success" ? "written" : "uncertain",
        detail:
          result._tag === "Success"
            ? `${resolution.reason === "answered" ? "Answer" : "Cancellation"} written to Pi. Consumption is unconfirmed; Pi sends no UI acknowledgement.`
            : `Dialog response delivery is uncertain. It will not be retried or reopened. Inspect the session; restart Pi if blocked. ${result.failure.detail}`,
      };
      yield* Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const state = yield* stateOf;
          if (state.dialogResolution?.id === dialog.id && !announced)
            yield* publish({ _tag: "state", state: { ...state, dialogResolution: final } });
          if (result._tag === "Failure")
            yield* publish({ _tag: "notice", level: "error", message: final.detail });
        }),
      );
      if (result._tag === "Failure") return yield* result.failure;
      return final;
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
            if (projected.dialog)
              dialogClosed.set(projected.dialog.id, yield* Deferred.make<void>());
            if (projected.state) yield* mergeState(projected.state);
            for (const event of projected.events) yield* publish(event);
            return projected;
          }),
        );
        yield* scheduleRefresh(...refresh);
        const closed = dialog && dialogClosed.get(dialog.id);
        if (!dialog || !closed) return;
        const abort = aborting;
        // Never stop stdout consumption while an extension or a pipe is blocked.
        yield* Effect.gen(function* () {
          if (abort) yield* Deferred.await(abort.dispatched);
          else
            yield* Effect.sleep(
              Math.max(0, dialog.deadlineAt - (yield* Clock.currentTimeMillis)),
            ).pipe(Effect.raceFirst(Deferred.await(closed)));
          yield* resolveDialog(
            dialog,
            abort ? "aborted" : dialog.deadlineKind === "pi-timeout" ? "expired" : "recovery",
          );
        }).pipe(Effect.ignore, Effect.forkIn(sessionScope));
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
          for (const dialog of yield* dialogsOf)
            yield* resolveDialog(dialog, "exited").pipe(Effect.ignore);
          const resolution = (yield* stateOf).dialogResolution;
          if (resolution?.delivery === "pending")
            yield* patchState({
              dialogResolution: {
                ...resolution,
                delivery: "uncertain",
                detail: "Pi stopped during response delivery. Do not resend this dialog response.",
              },
            });
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
              yield* child.request(command).pipe(
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
              const dialogs = yield* dialogsOf;
              const native = yield* child.request(command, dispatched).pipe(Effect.forkChild);
              // Order abort before releasing an extension that may continue work.
              // This waits for the transport attempt, NOT Pi's acknowledgement.
              yield* Deferred.await(dispatched);
              // Cancellation must not wait for native abort's acknowledgement:
              // idle extension commands often have no signal for it to cancel.
              for (const dialog of dialogs) {
                yield* resolveDialog(dialog, "aborted").pipe(Effect.ignore);
              }
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
              yield* child.request(yield* commandOf(piCommandFor(action))),
            );
            if (!messages)
              return yield* new PiSessionError({
                reason: "protocol",
                detail: "Pi returned an invalid cleared queue.",
              });
            return { _tag: "queue_restored", messages };
          }
          case "set_model":
            yield* child.request(yield* commandOf(piCommandFor(action)));
            yield* refreshState(operation);
            yield* refreshStats;
            return;
          case "set_thinking_level":
          case "set_name":
            yield* child.request(yield* commandOf(piCommandFor(action)));
            yield* refreshState(operation);
            return;
          case "answer": {
            const work = Effect.gen(function* () {
              const dialog = (yield* dialogsOf).find((open) => open.id === action.id);
              if (!dialog || action.generation !== generation)
                return yield* new PiSessionError({
                  reason: "rejected",
                  detail:
                    "Dialog is no longer open in this Pi process. Refresh the session; do not resend the answer.",
                });
              const answer = yield* commandOf(piCommandFor(action, dialog));
              const resolution = yield* resolveDialog(
                dialog,
                action.cancelled ? "cancelled" : "answered",
                answer,
              );
              if (
                !resolution ||
                resolution.reason === "expired" ||
                resolution.reason === "recovery"
              )
                return yield* new PiSessionError({
                  reason: "rejected",
                  detail:
                    "Dialog was already claimed or its host deadline elapsed. The answer was not sent.",
                });
            });
            yield* work.pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join));
            return;
          }
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
    });
  }),
);
