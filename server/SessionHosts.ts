/** Canonical execution ownership and the session lifecycle around it: create (folder, project
 * and reference before Pi starts), act (activity recorded before Pi sees it), rename, archive and
 * delete. Browser lifetimes never own acquisition or shutdown.
 * SessionReferences finds a session's history and judges whether it can be opened; this module
 * keys ownership by the physical checkout it returns and calls it under that key's lock.
 */
import { randomUUID } from "node:crypto";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  PubSub,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { isWorking } from "../shared/sessionProjection.ts";
import type { HostInfo, SessionClosure, Snapshot, StartOptions } from "../shared/wire.ts";
import { type PiSession, PiSessionError, PiSessions, sessionActionPolicy } from "./PiSessions.ts";
import { Registry, type RegistryError, type RegistryLookupError } from "./Registry.ts";
import {
  checkoutMissing,
  type SessionLocation,
  SessionReferences,
  SessionReferencesLive,
} from "./SessionReferences.ts";

export interface OpenSpec {
  readonly cwd: string;
  readonly sessionId: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly name?: string;
  /** Only a newly generated server ID may create a registry reference; `SessionHosts.create` generates one. */
  readonly create?: boolean;
  /** Initial registry membership for creation only; never passed to Pi or applied on reopen. */
  readonly projectId?: string;
}
/** A new session in a directory, which becomes a folder if it is not registered yet. */
export interface CreateSpec {
  readonly cwd: string;
  /** Initial project; it must be active, checked before anything is registered. */
  readonly projectId?: string;
  readonly options: StartOptions;
}
interface Host {
  session: PiSession;
  readonly scope: Scope.Closeable;
  lastActivity: number;
  actions: number;
  closing: boolean;
}
/** A session resolved under its ownership lock. `host` is live: a dead one has been stopped. */
interface Resolved {
  readonly key: string;
  readonly ref: SessionLocation;
  readonly host: Host | undefined;
}
const hostKey = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });

export class SessionHosts extends Context.Service<
  SessionHosts,
  {
    readonly get: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<PiSession | undefined, PiSessionError>;
    readonly open: (spec: OpenSpec) => Effect.Effect<PiSession, PiSessionError>;
    /**
     * Start a new session under a fresh server-generated ID. The project is checked before the
     * folder is registered; the folder, reference and project are written before Pi starts.
     */
    readonly create: (
      spec: CreateSpec,
    ) => Effect.Effect<PiSession, PiSessionError | RegistryError | RegistryLookupError>;
    /** Pi owns the name, so a stopped session is started for it; returns the mirrored title. */
    readonly rename: (
      cwd: string,
      sessionId: string,
      title: string,
    ) => Effect.Effect<string, PiSessionError | RegistryError>;
    /** Release keeps history and registration; it is not abort-current or archive. */
    readonly release: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    readonly peek: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<{ cwd: string; snapshot: Snapshot }, PiSessionError>;
    /** Capture Pi's saved branch under the ownership lock, without starting a child. */
    readonly exportBranch: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<string, PiSessionError>;
    /** Stop, then change retention under the same ownership lock. Stale opens fail. */
    readonly archive: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    readonly delete: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    readonly list: Effect.Effect<ReadonlyArray<HostInfo>>;
    readonly changes: Stream.Stream<ReadonlyArray<HostInfo>>;
  }
>()("piano/SessionHosts") {}

/** Also provides the SessionReferences it keys ownership by, so every caller shares its alias memory. */
export const SessionHostsLive = (options: { idleMs: number }) =>
  Layer.effect(
    SessionHosts,
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const registry = yield* Registry;
      const references = yield* SessionReferences;
      const layerScope = yield* Effect.scope;
      const hosts = new Map<string, Host>();
      const locks = new Map<string, Semaphore.Semaphore>();
      // Runtime diagnostics, not a competing history. Retained across child reopen,
      // not across server restart; no execution records are written into registry.
      const exits = new Map<string, SessionClosure>();
      const changed = yield* PubSub.sliding<ReadonlyArray<HostInfo>>(1);
      let stopping = false;
      const lockFor = (key: string) =>
        Effect.sync(() => {
          let lock = locks.get(key);
          if (!lock) {
            lock = Semaphore.makeUnsafe(1);
            locks.set(key, lock);
          }
          return lock;
        });
      const owned = <A, E>(work: Effect.Effect<A, E>) =>
        work.pipe(Effect.forkIn(layerScope), Effect.flatMap(Fiber.join));
      const keyed = <A, E>(
        cwd: string,
        sessionId: string,
        work: (key: string) => Effect.Effect<A, E>,
      ) =>
        owned(
          Effect.gen(function* () {
            const { physical } = yield* references.checkout(cwd);
            const key = hostKey(physical, sessionId);
            const lock = yield* lockFor(key);
            return yield* Semaphore.withPermits(lock, 1)(Effect.suspend(() => work(key)));
          }),
        );

      const list = Effect.gen(function* () {
        const out: HostInfo[] = [];
        for (const h of hosts.values()) {
          const state = yield* h.session.state;
          // A disappearing/closing child is not an idle (successfully settled) host.
          if (h.closing || state.closure) continue;
          out.push({
            cwd: h.session.spec.cwd,
            sessionId: h.session.spec.sessionId,
            streaming: isWorking(state),
          });
        }
        return out;
      });
      const announce = list.pipe(
        Effect.flatMap((l) => PubSub.publish(changed, l)),
        Effect.asVoid,
      );

      // Pi owns the session name and statistics; the registry only mirrors them for the sidebar.
      const mirror = (
        cwd: string,
        id: string,
        facts: Parameters<typeof registry.mirrorSession>[2],
      ) =>
        registry
          .mirrorSession(cwd, id, facts)
          .pipe(
            Effect.catchTag("RegistryError", (error) =>
              Effect.logWarning(`Could not mirror the session into the registry: ${error.detail}`),
            ),
          );

      const cacheStats = Effect.fn("SessionHosts.cacheStats")(function* (session: PiSession) {
        const state = yield* session.state;
        yield* mirror(session.spec.cwd, session.spec.sessionId, {
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

      // Caller holds this key's lock through actual process exit, not just close intent.
      const close = Effect.fn("SessionHosts.close")(function* (
        key: string,
        host: Host,
        closure?: SessionClosure,
      ) {
        if (hosts.get(key) !== host) return;
        host.closing = true;
        yield* Scope.close(host.scope, Exit.void);
        // PiSessions announces how its child stopped, including whether a release interrupted work.
        exits.set(
          key,
          closure ??
            (yield* host.session.state).closure ?? { _tag: "released", detail: "Pi was released" },
        );
        yield* cacheStats(host.session);
        hosts.delete(key);
        yield* announce;
      }, Effect.uninterruptible);

      /**
       * Resolve a session under its ownership lock, once: its reference and Pi file, whether its
       * checkout is missing, and its live host. A caller can beat the event watcher to this lock
       * after Pi exits or the checkout disappears, so a dead host is stopped first and the
       * reference re-read: stopping may persist the Pi file and final statistics.
       */
      const resolved = <A, E>(
        cwd: string,
        id: string,
        work: (r: Resolved) => Effect.Effect<A, E>,
        create = false,
      ) =>
        keyed(cwd, id, (key) =>
          Effect.gen(function* () {
            // Coalesced create calls can share an existing host; registration checks still
            // run for ordinary reopen so archive/delete cannot be undone by a stale tab.
            const fresh = create && !hosts.has(key);
            let ref = yield* references.resolve(cwd, id, { create: fresh });
            let host = hosts.get(key);
            if (host && (ref.checkoutMissing || (yield* host.session.state).closure)) {
              yield* close(key, host);
              host = undefined;
              ref = yield* references.resolve(cwd, id);
            }
            return yield* work({ key, ref, host });
          }),
        );

      const open = (spec: OpenSpec) =>
        resolved(
          spec.cwd,
          spec.sessionId,
          ({ key, ref, host: existing }) =>
            Effect.gen(function* () {
              if (stopping) return yield* rejected("Piano is shutting down.");
              if (ref.checkoutMissing) return yield* checkoutMissing;
              if (existing) return existing.session;
              const { create, projectId, ...piSpec } = spec;
              if (create)
                yield* registry
                  .addSession(ref.cwd, spec.sessionId, spec.name, projectId)
                  .pipe(Effect.mapError((e) => rejected(e.detail)));
              const scope = yield* Scope.make();
              const raw = yield* sessions
                .open({
                  ...piSpec,
                  cwd: ref.cwd,
                  sessionFile: ref.file,
                  lastKnownStats: ref.stats,
                })
                .pipe(
                  Scope.provide(scope),
                  Effect.onExit((exit) =>
                    Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void,
                  ),
                );
              if (stopping) {
                yield* Scope.close(scope, Exit.void);
                return yield* rejected("Piano is shutting down.");
              }
              const host: Host = {
                session: raw,
                scope,
                lastActivity: yield* Clock.currentTimeMillis,
                actions: 0,
                closing: false,
              };
              const session: PiSession = {
                ...raw,
                act: Effect.fn("SessionHosts.act")(function* (action) {
                  if (host.closing)
                    return yield* rejected(
                      "Pi is closing. Wait for shutdown before reopening history.",
                    );
                  // Outside the ownership lock, like the work itself: the reference and its
                  // project already exist, so activity is recorded before Pi sees the input.
                  if (sessionActionPolicy[action._tag].activity)
                    yield* registry
                      .touchSession(
                        raw.spec.cwd,
                        raw.spec.sessionId,
                        "text" in action ? action.text : undefined,
                      )
                      .pipe(Effect.mapError((e) => rejected(e.detail)));
                  const lock = yield* lockFor(key);
                  // Admit an action atomically against retirement, but don't hold the lock
                  // while awaiting a command whose dialog another action must answer.
                  const fiber = yield* Semaphore.withPermits(
                    lock,
                    1,
                  )(
                    Effect.gen(function* () {
                      if (hosts.get(key) !== host || host.closing)
                        return yield* rejected(
                          "Pi is closing or has stopped. Refresh before sending new input.",
                        );
                      if (sessionActionPolicy[action._tag].needsCheckout)
                        yield* references.requireCheckout(raw.spec.cwd);
                      host.actions++;
                      host.lastActivity = yield* Clock.currentTimeMillis;
                      return yield* raw.act(action).pipe(
                        Effect.ensuring(
                          Effect.gen(function* () {
                            host.actions--;
                            host.lastActivity = yield* Clock.currentTimeMillis;
                          }),
                        ),
                        Effect.forkIn(scope),
                      );
                    }),
                  );
                  return yield* Fiber.join(fiber);
                }),
              };
              host.session = session;
              hosts.set(key, host);
              yield* cacheStats(session);
              const ready = yield* Deferred.make<void>();
              yield* session.events.pipe(
                Stream.runForEach((event) =>
                  Effect.gen(function* () {
                    // Signal attachment before taking ownership's lock: open holds it until ready.
                    if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
                    if (event._tag === "state" || event._tag === "snapshot") {
                      const lock = yield* lockFor(key);
                      yield* Semaphore.withPermits(
                        lock,
                        1,
                      )(
                        Effect.gen(function* () {
                          // Serialize against close/replacement and read current state, not an old
                          // queued frame. A retired observer must never overwrite a newer cache.
                          if (hosts.get(key) === host && !host.closing) yield* cacheStats(session);
                        }),
                      );
                    }
                    host.lastActivity = yield* Clock.currentTimeMillis;
                    const closure =
                      event._tag === "closed"
                        ? event.closure
                        : event._tag === "snapshot"
                          ? event.snapshot.state.closure
                          : undefined;
                    if (closure) {
                      // Retire only this incarnation. A late event must never close a replacement.
                      const lock = yield* lockFor(key);
                      yield* owned(Semaphore.withPermits(lock, 1)(close(key, host, closure)));
                    } else if (event._tag === "state" || event._tag === "snapshot") yield* announce;
                  }),
                ),
                // The host observer also recaptures after overflow; it must never lose exit
                // ownership just because sidebar observation briefly fell behind.
                Effect.retry({}),
                Effect.ignore,
                Effect.forkIn(layerScope),
              );
              yield* Deferred.await(ready);
              yield* announce;
              return session;
            }),
          spec.create,
        );

      const create = Effect.fn("SessionHosts.create")(function* (spec: CreateSpec) {
        // Registry writes run before the ownership lock; an unavailable project registers nothing.
        if (spec.projectId !== undefined) yield* registry.requireActiveProject(spec.projectId);
        const cwd = yield* registry.ensureFolder(spec.cwd);
        const { model, thinkingLevel, name } = spec.options;
        // Only a fresh server-generated ID may create a reference. Registration and initial
        // membership survive a disconnected requester, as acquisition is server-owned.
        return yield* open({
          cwd,
          sessionId: randomUUID(),
          create: true,
          projectId: spec.projectId,
          model,
          thinkingLevel,
          name,
        });
      });

      const get = (cwd: string, id: string) =>
        resolved(cwd, id, ({ host }) => Effect.succeed(host?.session));

      const rename = Effect.fn("SessionHosts.rename")(function* (
        cwd: string,
        sessionId: string,
        title: string,
      ) {
        // The idle deadline releases a session started only for this.
        const session = (yield* get(cwd, sessionId)) ?? (yield* open({ cwd, sessionId }));
        yield* session.act({ _tag: "set_name", name: title });
        const mirrored = (yield* session.state).sessionName ?? title;
        yield* registry.mirrorSession(session.spec.cwd, session.spec.sessionId, {
          sessionName: mirrored,
        });
        return mirrored;
      });

      const release = (cwd: string, id: string) =>
        keyed(cwd, id, (key) => {
          const host = hosts.get(key);
          return host ? close(key, host) : Effect.void;
        });
      const retire = (cwd: string, id: string, remove: boolean) =>
        resolved(cwd, id, ({ key, ref, host }) =>
          Effect.gen(function* () {
            // Discover the final file AFTER shutdown; a last response may have persisted it.
            const final = host
              ? yield* close(key, host).pipe(Effect.andThen(references.resolve(ref.cwd, id)))
              : ref;
            yield* remove ? references.remove(final) : references.archive(final);
          }),
        );

      if (options.idleMs > 0)
        yield* Effect.gen(function* () {
          for (const [key, host] of hosts) {
            const lock = yield* lockFor(key);
            yield* Semaphore.withPermits(
              lock,
              1,
            )(
              Effect.gen(function* () {
                if (
                  hosts.get(key) !== host ||
                  host.closing ||
                  host.actions ||
                  (yield* Clock.currentTimeMillis) - host.lastActivity < options.idleMs
                )
                  return;
                if (!(yield* host.session.state).isQuiescent) return;
                yield* close(key, host);
              }),
            );
          }
        }).pipe(Effect.delay(Math.min(15_000, options.idleMs)), Effect.forever, Effect.forkScoped);

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          stopping = true;
          for (const [key, host] of hosts) yield* close(key, host);
        }),
      );
      return SessionHosts.of({
        open,
        create,
        rename,
        release,
        get,
        peek: (cwd, id) =>
          resolved(cwd, id, ({ key, ref }) =>
            Effect.gen(function* () {
              const snapshot = yield* references.peek(ref);
              yield* mirror(ref.cwd, id, { sessionName: snapshot.state.sessionName });
              return {
                cwd: ref.cwd,
                snapshot: { ...snapshot, state: { ...snapshot.state, closure: exits.get(key) } },
              };
            }),
          ),
        exportBranch: (cwd, id) =>
          resolved(cwd, id, ({ ref, host }) =>
            Effect.gen(function* () {
              if (host && (host.actions || !(yield* host.session.state).isQuiescent))
                return yield* rejected("Wait for this session to finish before sharing.");
              return yield* references.exportBranch(ref);
            }),
          ),
        archive: (cwd, id) => retire(cwd, id, false),
        delete: (cwd, id) => retire(cwd, id, true),
        list,
        changes: Stream.fromPubSub(changed),
      });
    }),
  ).pipe(Layer.provideMerge(SessionReferencesLive));
