/** One running session from start to close: its Pi child, input admission (activity recorded
 * before Pi sees it, checkout required, in-flight actions counted), the single "busy" rule that
 * idle release and branch export share, the registry mirror of Pi's name and statistics, and
 * closing itself when its child exits. SessionHosts keys hosts by checkout and owns their locks.
 */
import { Clock, Deferred, Effect, Exit, Fiber, Scope, Semaphore, Stream } from "effect";
import type { SessionClosure } from "../shared/wire.ts";
import { Notifications } from "./Notifications.ts";
import {
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
  const { lock } = options;

  const scope = yield* Scope.make();
  const raw = yield* sessions.open(options.spec).pipe(
    Scope.provide(scope),
    Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void)),
  );
  let lastActivity = yield* Clock.currentTimeMillis;
  let actions = 0;
  let closing = false;

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

  const act: PiSession["act"] = Effect.fn("SessionHost.act")(function* (action) {
    if (closing)
      return yield* rejected("Pi is closing. Wait for shutdown before reopening history.");
    // Outside the ownership lock, like the work itself: the reference and its project already
    // exist, so activity is recorded before Pi sees the input.
    if (sessionActionPolicy[action._tag].activity)
      yield* registry
        .touchSession(raw.spec.cwd, raw.spec.sessionId, "text" in action ? action.text : undefined)
        .pipe(Effect.mapError((e) => rejected(e.detail)));
    // Admit an action atomically against retirement, but don't hold the lock while awaiting a
    // command whose dialog another action must answer.
    const fiber = yield* Semaphore.withPermits(
      lock,
      1,
    )(
      Effect.gen(function* () {
        if (closing)
          return yield* rejected("Pi is closing or has stopped. Refresh before sending new input.");
        if (sessionActionPolicy[action._tag].needsCheckout)
          yield* references.requireCheckout(raw.spec.cwd);
        actions++;
        lastActivity = yield* Clock.currentTimeMillis;
        return yield* raw.act(action).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              actions--;
              lastActivity = yield* Clock.currentTimeMillis;
            }),
          ),
          Effect.forkIn(scope),
        );
      }),
    );
    return yield* Fiber.join(fiber);
  });
  // Neither an action nor a subscription here is presence: ClientSessions decides when a person
  // is at the session.
  const session: PiSession = { ...raw, act };

  const busy = Effect.map(raw.state, (state) => actions > 0 || !state.isQuiescent);
  const host: SessionHost = {
    session,
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
      return closed;
    }, Effect.uninterruptible),
  };

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
          )(Effect.suspend(() => (closing ? Effect.void : mirrorStats)));
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
