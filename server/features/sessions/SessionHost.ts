import { Clock, Deferred, Effect, Exit, Fiber, Scope, Semaphore, Stream } from "effect";
import { applySessionEvent } from "../../../shared/features/sessions/sessionProjection.ts";
import { workUnderWay } from "../../../shared/features/sessions/sessionStatus.ts";
import type {
  HostInfo,
  SessionAction,
  SessionClosure,
  SessionState,
  Snapshot,
} from "../../../shared/wire.ts";
import { Registry } from "../../shared/registry/Registry.ts";
import { Webhooks } from "../webhooks/Webhooks.ts";
import {
  type PiSession,
  PiSessionError,
  type PiSessionSpec,
  PiSessions,
  refusedUnsent,
  sessionActionPolicy,
} from "./pi/PiSessions.ts";
import { SessionReferences } from "./SessionReferences.ts";

export interface SessionHost {
  readonly session: PiSession;
  readonly closing: boolean;
  readonly busy: Effect.Effect<boolean>;
  readonly idle: (idleMs: number) => Effect.Effect<boolean>;
  readonly close: (how?: CloseHow) => Effect.Effect<SessionClosure>;
}

export interface CloseHow {
  readonly closure?: SessionClosure;
  readonly requested?: boolean;
}

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });
const stopped = () => rejected("Pi is closing or has stopped. Refresh before sending new input.");
const notSent = (error: PiSessionError) => refusedUnsent(error.reason, error.detail);

export const listedFacts = (state: SessionState): Pick<HostInfo, "working"> => ({
  working: workUnderWay(state),
});

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

export const makeSessionHost = Effect.fn("SessionHost.make")(function* (options: {
  readonly spec: PiSessionSpec;
  readonly lock: Semaphore.Semaphore;
  readonly onChange: Effect.Effect<void>;
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

  const admit = Effect.fn("SessionHost.admit")(function* (action: SessionAction) {
    if (closing)
      return yield* rejected("Pi is closing. Wait for shutdown before reopening history.");
    if (sessionActionPolicy[action._tag].activity) {
      yield* Semaphore.withPermits(
        lock,
        1,
      )(Effect.suspend(() => (closing ? Effect.fail(stopped()) : Effect.void)));
      if (sessionActionPolicy[action._tag].needsCheckout)
        yield* references.requireCheckout(raw.spec.cwd);
      yield* registry
        .touchSession(raw.spec.cwd, raw.spec.sessionId, "text" in action ? action.text : undefined)
        .pipe(Effect.mapError((e) => rejected(e.detail)));
    }
  });

  const act: PiSession["act"] = Effect.fn("SessionHost.act")(function* (action) {
    yield* admit(action).pipe(Effect.mapError(notSent));
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
      return !(yield* busy);
    }),
    close: Effect.fn("SessionHost.close")(function* ({
      closure,
      requested = false,
    }: CloseHow = {}) {
      if (requested) yield* raw.requestRelease;
      closing = true;
      yield* Scope.close(scope, Exit.void);
      const closed = closure ??
        (yield* raw.state).closure ?? { _tag: "released", detail: "Pi was released" };
      yield* mirrorStats;
      return closed;
    }, Effect.uninterruptible),
  };

  yield* mirrorStats;
  const ready = yield* Deferred.make<void>();
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
        if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
        if (event._tag === "state" || event._tag === "snapshot")
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
          if (facts.working === announced?.working) return;
          announced = facts;
          yield* options.onChange;
        }
      }),
    ),
    Effect.retry({}),
    Effect.ignore,
    Effect.forkIn(observerScope),
  );
  yield* Deferred.await(ready);
  return host;
});
