/** One running session from start to close: its Pi child, input admission (activity recorded
 * before Pi sees it, checkout required, in-flight actions counted), the single "busy" rule that
 * idle release and branch export share, the registry mirror of Pi's name and statistics, and
 * closing itself when its child exits. SessionHosts keys hosts by checkout and owns their locks.
 */
import { Clock, Deferred, Effect, Exit, Fiber, Scope, Semaphore, Stream } from "effect";
import type { Dialog, SessionAction, SessionClosure } from "../shared/wire.ts";
import { deriveStatus, snapshotStatus } from "./ApiStatus.ts";
import { Notifications } from "./Notifications.ts";
import {
  PiRequestTimeoutMs,
  type PiSession,
  PiSessionError,
  type PiSessionSpec,
  PiSessions,
  sessionActionPolicy,
} from "./PiSessions.ts";
import { Registry } from "./Registry.ts";
import { SessionReferences } from "./SessionReferences.ts";

export interface SessionHost {
  /** Pi's session, with `act` admitted by this host. */
  readonly session: PiSession;
  /** Bounded startup drain used only by API create-and-submit, before normal admission. */
  readonly startupReady: Effect.Effect<void, PiSessionError>;
  /** API input shares act's admission and counters, but returns before Pi acknowledges/finishes. */
  readonly submit: (
    text: string,
    mode: "prompt" | "steer",
    opened?: boolean,
  ) => Effect.Effect<number, PiSessionError>;
  /** Set once close begins; a closing host rejects new input and never mirrors again. */
  readonly closing: boolean;
  /** Busy as of now: an admitted action is in flight or Pi is not quiescent (INV-02/03). */
  readonly busy: Effect.Effect<boolean>;
  /** Not closing, not busy, and without activity for `idleMs`. */
  readonly idle: (idleMs: number) => Effect.Effect<boolean>;
  /**
   * Stop the child and mirror its final facts; returns how it closed. The caller holds the
   * ownership lock through actual process exit, not just close intent.
   */
  readonly close: (closure?: SessionClosure) => Effect.Effect<SessionClosure>;
}

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });

/** Pi owns the session name and statistics; the registry only mirrors them for the sidebar. */
export const mirrorSession = (
  registry: Registry["Service"],
  cwd: string,
  sessionId: string,
  facts: Parameters<Registry["Service"]["mirrorSession"]>[2],
) =>
  registry
    .mirrorSession(cwd, sessionId, facts)
    .pipe(
      Effect.catchTag("RegistryError", (error) =>
        Effect.logWarning(`Could not mirror the session into the registry: ${error.detail}`),
      ),
    );

/**
 * Start Pi for a resolved session reference. Call it under `lock`, the ownership lock of the
 * session's key: actions are admitted under it, and the event observer takes it before mirroring
 * or reporting exit, so neither runs until the caller has recorded this host. The observer lives
 * in the calling Scope; the child lives until `close`.
 */
export const makeSessionHost = Effect.fn("SessionHost.make")(function* (options: {
  readonly spec: PiSessionSpec;
  readonly apiOwned?: boolean;
  readonly lock: Semaphore.Semaphore;
  /** Running state changed; announce it. */
  readonly onChange: Effect.Effect<void>;
  /** The child exited by itself; retire this host. Runs from the observer, outside the lock. */
  readonly onExit: (closure: SessionClosure) => Effect.Effect<void>;
}): Effect.fn.Return<
  SessionHost,
  PiSessionError,
  PiSessions | Registry | SessionReferences | Notifications | Scope.Scope
> {
  const sessions = yield* PiSessions;
  const registry = yield* Registry;
  const notifications = yield* Notifications;
  const references = yield* SessionReferences;
  const observerScope = yield* Effect.scope;
  const startupTimeoutMs = yield* PiRequestTimeoutMs;
  const { lock } = options;

  const scope = yield* Scope.make();
  const raw = yield* sessions.open(options.spec).pipe(
    Scope.provide(scope),
    Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void)),
  );
  let lastActivity = yield* Clock.currentTimeMillis;
  let actions = 0;
  let startupActionsDone = Deferred.makeUnsafe<void>();
  let closing = false;
  let apiOwned = options.apiOwned ?? false;
  let seq =
    (yield* registry.get).sessions.find(
      (s) => s.cwd === raw.spec.cwd && s.sessionId === raw.spec.sessionId,
    )?.seq ?? 0;
  let completedSeq = seq;

  const mirrorStats = Effect.gen(function* () {
    const state = yield* raw.state;
    yield* mirrorSession(registry, raw.spec.cwd, raw.spec.sessionId, {
      sessionName: state.sessionName,
      stats:
        state.statsUpdatedAt === undefined
          ? undefined
          : {
              context: state.context,
              cost: state.cost,
              tokens: state.tokens,
              statsUpdatedAt: state.statsUpdatedAt,
            },
    });
  });

  const complete = Effect.gen(function* () {
    const state = yield* raw.state;
    if (!state.closure && (actions > 0 || !state.isQuiescent)) return;
    // A started/queued disposition is the LAST acknowledgement, not outstanding work once
    // Pi is quiescent. Preserve rejections, which remain an error until the next input.
    const status = deriveStatus(
      {
        ...state,
        submission: state.submission?.outcome === "rejected" ? state.submission : undefined,
      },
      [],
      !state.closure,
    );
    const observedSeq = seq;
    yield* registry
      .recordTurn(raw.spec.cwd, raw.spec.sessionId, {
        status: status.status === "error" ? "error" : "idle",
        detail: status.detail,
        completedSeq: observedSeq,
      })
      .pipe(Effect.orDie);
    completedSeq = Math.max(completedSeq, observedSeq);
  });

  const admit = Effect.fn("SessionHost.admit")(function* (action: SessionAction, api = false) {
    if (closing)
      return yield* rejected("Pi is closing. Wait for shutdown before reopening history.");
    // Any action means the user is here: a completion message waiting for this session is dropped.
    yield* notifications.touched(raw.spec.sessionId);
    // Outside the ownership lock, like the work itself: the reference and its project already
    // exist, so activity is recorded before Pi sees the input.
    if (sessionActionPolicy[action._tag].activity)
      yield* registry
        .touchSession(raw.spec.cwd, raw.spec.sessionId, "text" in action ? action.text : undefined)
        .pipe(Effect.mapError((e) => rejected(e.detail)));
    // Admit an action atomically against retirement, but don't hold the lock while awaiting a
    // command whose dialog another action must answer.
    return yield* Semaphore.withPermits(
      lock,
      1,
    )(
      Effect.gen(function* () {
        if (closing)
          return yield* rejected("Pi is closing or has stopped. Refresh before sending new input.");
        if (sessionActionPolicy[action._tag].needsCheckout)
          yield* references.requireCheckout(raw.spec.cwd);
        if (api) {
          const snapshot = yield* raw.snapshot;
          if (snapshot.state.isStopping || snapshot.state.checkoutMissing)
            return yield* rejected(
              snapshot.state.checkoutMissing
                ? "Session checkout is missing."
                : "Session is stopping.",
            );
          const { status } = snapshotStatus(snapshot, true);
          if (
            action._tag !== "steer" &&
            (actions > 0 || status === "running" || status === "waiting")
          )
            return yield* rejected("Session is busy.");
          apiOwned = true;
          yield* cancelDialogs(snapshot.dialogs).pipe(Effect.forkIn(observerScope));
        }
        if (action._tag === "prompt" || action._tag === "steer")
          seq = yield* registry
            .recordTurn(raw.spec.cwd, raw.spec.sessionId, "accepted")
            .pipe(Effect.mapError((e) => rejected(e.detail)));
        if (options.apiOwned && actions === 0) startupActionsDone = Deferred.makeUnsafe<void>();
        actions++;
        lastActivity = yield* Clock.currentTimeMillis;
        const fiber = yield* raw.act(action).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              actions--;
              if (actions === 0) Deferred.doneUnsafe(startupActionsDone, Effect.void);
              lastActivity = yield* Clock.currentTimeMillis;
              yield* complete;
            }),
          ),
          Effect.forkIn(scope, { uninterruptible: false }),
        );
        return { fiber, seq };
      }),
    );
  }, Effect.uninterruptible);
  const act: PiSession["act"] = Effect.fn("SessionHost.act")(function* (action) {
    const { fiber } = yield* admit(action);
    return yield* Fiber.join(fiber);
  });
  const cancelDialogs = (dialogs: ReadonlyArray<Dialog>) =>
    Effect.forEach(
      dialogs,
      (dialog) =>
        act({ _tag: "answer", id: dialog.id, generation: dialog.generation, cancelled: true }).pipe(
          // A browser answer, timeout or abort can win the same claim; PiSessions owns that race.
          Effect.ignore,
        ),
      { discard: true },
    );
  // Opening the session in a browser subscribes to its events, which also counts as being here.
  // The host's own observer below subscribes once at creation, before any completion can wait.
  const session: PiSession = {
    ...raw,
    act,
    state: Effect.map(raw.state, (state) =>
      actions > 0 ? { ...state, isQuiescent: false } : state,
    ),
    snapshot: Effect.map(raw.snapshot, (snapshot) =>
      actions > 0 ? { ...snapshot, state: { ...snapshot.state, isQuiescent: false } } : snapshot,
    ),
    events: Stream.unwrap(Effect.as(notifications.touched(raw.spec.sessionId), raw.events)),
  };

  const busy = Effect.map(raw.state, (state) => actions > 0 || !state.isQuiescent);
  const host: SessionHost = {
    session,
    startupReady: Effect.gen(function* () {
      while (true) {
        yield* raw.startupReady;
        if (actions === 0 || (yield* raw.state).submission) return;
        yield* Deferred.await(startupActionsDone);
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: startupTimeoutMs,
        orElse: () => rejected("Pi startup did not settle before the first prompt."),
      }),
    ),
    submit: Effect.fn("SessionHost.submit")(function* (text, mode, opened = false) {
      // Cached-stat refresh is deliberately asynchronous on browser reopen. For a host this
      // request just opened, let that initial readback drain before applying the busy gate.
      // Never wait for another input, dialog or actual work to finish and then send stale input.
      // Creation can itself open an extension dialog. Ownership is set before observation,
      // so let its cancellation finish before the first prompt, rather than orphaning creation.
      if (options.apiOwned) {
        while (!closing && seq === 0) {
          const snapshot = yield* raw.snapshot;
          if (snapshot.state.closure || (actions === 0 && snapshot.dialogs.length === 0)) break;
          yield* Effect.sleep(5);
        }
      }
      if (opened || (options.apiOwned && seq === 0)) {
        while (!closing && actions === 0) {
          const snapshot = yield* raw.snapshot;
          if (
            snapshot.state.isQuiescent ||
            snapshot.state.submission ||
            snapshot.state.closure ||
            snapshotStatus({ ...snapshot, state: { ...snapshot.state, isQuiescent: true } }, true)
              .status !== "idle"
          )
            break;
          yield* Effect.sleep(5);
        }
      }
      const accepted = yield* admit({ _tag: mode, text }, true);
      // The host scope owns the work, even if this HTTP caller goes away.
      return accepted.seq;
    }),
    get closing() {
      return closing;
    },
    busy,
    idle: (idleMs) =>
      Effect.gen(function* () {
        if (closing || (yield* Clock.currentTimeMillis) - lastActivity < idleMs) return false;
        return !(yield* busy);
      }),
    close: Effect.fn("SessionHost.close")(function* (closure?: SessionClosure) {
      closing = true;
      yield* Scope.close(scope, Exit.void);
      // PiSessions announces how its child stopped, including whether a release interrupted work.
      const closed = closure ??
        (yield* raw.state).closure ?? { _tag: "released", detail: "Pi was released" };
      yield* mirrorStats;
      yield* complete;
      return closed;
    }, Effect.uninterruptible),
  };

  // Quiescence includes transport/readback drain, which can change after the last published
  // state event. Observe outstanding turns independently of events or HTTP polling; the child
  // scope stops this observer on release. No database writes while a turn is still busy.
  yield* Effect.gen(function* () {
    while (!closing) {
      if (seq > completedSeq) yield* complete;
      yield* Effect.sleep(50);
    }
  }).pipe(Effect.forkIn(scope));

  yield* mirrorStats;
  const ready = yield* Deferred.make<void>();
  yield* session.events.pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        // Signal attachment before taking ownership's lock: the opener holds it until ready.
        if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
        if (event._tag === "state" || event._tag === "snapshot")
          // Serialize against close/replacement and read current state, not an old queued
          // frame. A retired observer must never overwrite a newer cache.
          yield* Semaphore.withPermits(
            lock,
            1,
          )(Effect.suspend(() => (closing ? Effect.void : Effect.all([mirrorStats, complete]))));
        if (apiOwned && !closing && (event._tag === "dialog" || event._tag === "snapshot"))
          yield* cancelDialogs(
            event._tag === "dialog" ? [event.dialog] : event.snapshot.dialogs,
          ).pipe(Effect.forkIn(observerScope));
        if (event._tag === "response_completed" && !closing)
          yield* notifications.completed(raw.spec.sessionId);
        lastActivity = yield* Clock.currentTimeMillis;
        const closure =
          event._tag === "closed"
            ? event.closure
            : event._tag === "snapshot"
              ? event.snapshot.state.closure
              : undefined;
        if (closure) yield* options.onExit(closure);
        else if (event._tag === "state" || event._tag === "snapshot") yield* options.onChange;
      }),
    ),
    // The observer also recaptures after overflow; it must never lose exit ownership just
    // because sidebar observation briefly fell behind.
    Effect.retry({}),
    Effect.ignore,
    Effect.forkIn(observerScope),
  );
  yield* Deferred.await(ready);
  return host;
});
