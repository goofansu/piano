/** One running session from start to close: its Pi child, input admission (activity recorded
 * before Pi sees it, checkout required, in-flight actions counted), the single "busy" rule that
 * idle release and branch export share, the registry mirror of Pi's name and statistics, and
 * closing itself when its child exits. SessionHosts keys hosts by checkout and owns their locks.
 */
import { Clock, Deferred, Effect, Exit, Fiber, Scope, Semaphore, Stream } from "effect";
import { applySessionEvent } from "../shared/sessionProjection.ts";
import { workUnderWay } from "../shared/sessionStatus.ts";
import type {
  HostInfo,
  SessionAction,
  SessionClosure,
  SessionState,
  Snapshot,
} from "../shared/wire.ts";
import {
  type PiSession,
  PiSessionError,
  type PiSessionSpec,
  PiSessions,
  sessionActionPolicy,
} from "./PiSessions.ts";
import { Registry } from "./Registry.ts";
import { SessionReferences } from "./SessionReferences.ts";
import { Webhooks } from "./Webhooks.ts";

export interface SessionHost {
  /** Pi's session, with `act` admitted by this host. */
  readonly session: PiSession;
  /** Set once close begins; a closing host rejects new input and never mirrors again. */
  readonly closing: boolean;
  /** Busy as of now: an admitted action is in flight or Pi is not quiescent (INV-02/03). */
  readonly busy: Effect.Effect<boolean>;
  /** Not closing, not busy, and without activity for `idleMs`. */
  readonly idle: (idleMs: number) => Effect.Effect<boolean, PiSessionError>;
  /**
   * Stop the child and mirror its final facts; returns how it closed. The caller holds the
   * ownership lock through actual process exit, not just close intent.
   */
  readonly close: (how?: CloseHow) => Effect.Effect<SessionClosure, PiSessionError>;
}

export interface CloseHow {
  /** How the child already stopped, when its exit is why the host closes. */
  readonly closure?: SessionClosure;
  /** Piano is stopping: a failed release is logged, not refused. */
  readonly shutdown?: boolean;
  /** The person asked for this stop (archive or delete): interrupting work is not a failure. */
  readonly requested?: boolean;
}

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });
const stopped = () => rejected("Pi is closing or has stopped. Refresh before sending new input.");
/** A refusal before Pi saw the action, so its sender may take the input back. */
const notSent = (error: PiSessionError) =>
  new PiSessionError({ reason: error.reason, detail: error.detail, notSent: true });

/** What the hosts list says of a running session. The host announces a change whenever these
 * facts differ from those it last announced, whichever event changed them. */
export const listedFacts = (state: SessionState): Pick<HostInfo, "working" | "preview"> => ({
  working: workUnderWay(state),
  ...(state.preview && { preview: true }),
});

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
  /** The facts the hosts list shows of this session changed; announce them. */
  readonly onChange: Effect.Effect<void>;
  /** The child exited by itself; retire this host. Runs from the observer, outside the lock. */
  readonly onExit: (closure: SessionClosure) => Effect.Effect<void>;
}): Effect.fn.Return<
  SessionHost,
  PiSessionError,
  PiSessions | Registry | SessionReferences | Webhooks | Scope.Scope
> {
  const sessions = yield* PiSessions;
  const registry = yield* Registry;
  const references = yield* SessionReferences;
  const webhooks = yield* Webhooks;
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

  // Every refusal before `raw.act` is one Pi never saw.
  const admit = Effect.fn("SessionHost.admit")(function* (action: SessionAction) {
    if (closing)
      return yield* rejected("Pi is closing. Wait for shutdown before reopening history.");
    // Outside the ownership lock, like the work itself: the reference and its project already
    // exist, so activity is recorded before Pi sees the input. First wait out a close that holds
    // the lock (idle release, a requested stop, Pi's exit), so input it refuses records none.
    if (sessionActionPolicy[action._tag].activity) {
      yield* Semaphore.withPermits(
        lock,
        1,
      )(Effect.suspend(() => (closing ? Effect.fail(stopped()) : Effect.void)));
      // Refuse before recording, so input for a missing checkout leaves no activity; admission
      // below checks again, atomically.
      if (sessionActionPolicy[action._tag].needsCheckout)
        yield* references.requireCheckout(raw.spec.cwd);
      yield* registry
        .touchSession(raw.spec.cwd, raw.spec.sessionId, "text" in action ? action.text : undefined)
        .pipe(Effect.mapError((e) => rejected(e.detail)));
    }
  });

  const act: PiSession["act"] = Effect.fn("SessionHost.act")(function* (action) {
    yield* admit(action).pipe(Effect.mapError(notSent));
    // Admit an action atomically against retirement, but don't hold the lock while awaiting a
    // command whose dialog another action must answer.
    const fiber = yield* Semaphore.withPermits(
      lock,
      1,
    )(
      Effect.gen(function* () {
        if (closing) return yield* Effect.fail(notSent(stopped()));
        if (sessionActionPolicy[action._tag].needsCheckout)
          yield* references.requireCheckout(raw.spec.cwd).pipe(Effect.mapError(notSent));
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
  const session: PiSession = { ...raw, act };

  const busy = Effect.map(raw.state, (state) => actions > 0 || !state.isQuiescent);
  const host: SessionHost = {
    session,
    get closing() {
      return closing;
    },
    busy,
    idle: Effect.fn("SessionHost.idle")(function* (idleMs: number) {
      if (closing || (yield* Clock.currentTimeMillis) - lastActivity < idleMs) return false;
      if (yield* busy) return false;
      return yield* raw.prepareRelease("idle");
    }),
    close: Effect.fn("SessionHost.close")(function* ({
      closure,
      shutdown = false,
      requested = false,
    }: CloseHow = {}) {
      // Do not claim archive/delete succeeded, or drop this owner, if cleanup is uncertain.
      // The broker fences launches immediately; repeated close retries the retained identity.
      yield* raw
        .prepareRelease(requested ? "requested" : undefined)
        .pipe(
          Effect.catchTag("PiSessionError", (error) =>
            shutdown ? Effect.logWarning(error.detail) : Effect.fail(error),
          ),
        );
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
  // The session's live view, folded from its events for Webhooks, which decides what it sends.
  let observed: Snapshot | undefined;
  let announced: ReturnType<typeof listedFacts> | undefined;
  yield* session.events.pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        const previous = observed;
        observed =
          event._tag === "snapshot"
            ? event.snapshot
            : previous
              ? applySessionEvent(previous, event)
              : undefined;
        if (observed)
          yield* webhooks.observe(raw.spec.cwd, raw.spec.sessionId, previous, event, observed);
        // Signal attachment before taking ownership's lock: the opener holds it until ready.
        if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
        if (event._tag === "state" || event._tag === "snapshot")
          // Serialize against close/replacement and read current state, not an old queued
          // frame. A retired observer must never overwrite a newer cache.
          yield* Semaphore.withPermits(
            lock,
            1,
          )(Effect.suspend(() => (closing ? Effect.void : mirrorStats)));
        lastActivity = yield* Clock.currentTimeMillis;
        const closure =
          event._tag === "closed"
            ? event.closure
            : event._tag === "snapshot"
              ? event.snapshot.state.closure
              : undefined;
        if (closure) yield* options.onExit(closure);
        else if (observed) {
          const facts = listedFacts(observed.state);
          if (facts.working === announced?.working && facts.preview === announced.preview) return;
          announced = facts;
          yield* options.onChange;
        }
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
