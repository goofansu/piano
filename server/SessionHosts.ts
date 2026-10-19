/** Canonical execution ownership and the session lifecycle around it: create (folder, project
 * and reference before Pi starts), open, rename, release, archive and delete. A SessionHost owns
 * each running session; this module keys hosts, locks keys, and orders retirement. Browser
 * lifetimes never own acquisition or shutdown.
 * SessionReferences finds a session's history and judges whether it can be opened; this module
 * keys ownership by the physical checkout it returns and calls it under that key's lock.
 */
import { randomUUID } from "node:crypto";
import { Context, Data, Effect, Fiber, Layer, PubSub, Scope, Semaphore, Stream } from "effect";
import { isWorking } from "../shared/sessionProjection.ts";
import type {
  HostInfo,
  SessionClosure,
  SlashCommand,
  Snapshot,
  StartOptions,
} from "../shared/wire.ts";
import { type Notifications, NotificationsLive } from "./Notifications.ts";
import { type PiSession, PiSessionError, type PiSessions } from "./PiSessions.ts";
import { Registry, type RegistryError, type RegistryLookupError } from "./Registry.ts";
import { makeSessionHost, mirrorSession, type SessionHost } from "./SessionHost.ts";
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
  readonly dispatchedFrom?: string;
}
/** An opened session, and whether this call launched Pi with its spec's start options. */
export interface Opened {
  readonly session: PiSession;
  readonly launched: boolean;
}
/** A new session in a directory, which becomes a folder if it is not registered yet. */
export interface CreateSpec {
  readonly cwd: string;
  /** Initial project; it must be active, checked before anything is registered. */
  readonly projectId?: string;
  readonly options: StartOptions;
}
/** Only `create`'s fresh server-generated ID may create a registry reference. */
interface Creation {
  /** Initial registry membership; never passed to Pi or applied on reopen. */
  readonly projectId?: string;
}
/** A session resolved under its ownership lock. `host` is live: a dead one has been stopped. */
interface Resolved {
  readonly key: string;
  readonly ref: SessionLocation;
  readonly host: SessionHost | undefined;
}
/** Slash commands a session could not answer with; `detail` is written for people. */
export class SessionCommandsError extends Data.TaggedError("SessionCommandsError")<{
  readonly detail: string;
}> {}

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
    /** Like `open`, and says whether Pi launched with `spec`'s start options; a session that
     * was already running ignores them. */
    readonly start: (spec: OpenSpec) => Effect.Effect<Opened, PiSessionError>;
    /** A running session's slash commands, from its own child. A stopped session is refused,
     * never started to answer (INV-02). */
    readonly commands: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<ReadonlyArray<SlashCommand>, SessionCommandsError>;
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
      const registry = yield* Registry;
      const references = yield* SessionReferences;
      const layerScope = yield* Effect.scope;
      const hostServices = yield* Effect.context<
        PiSessions | Registry | SessionReferences | Notifications
      >();
      const hosts = new Map<string, SessionHost>();
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

      // Caller holds this key's lock through actual process exit, not just close intent.
      const close = Effect.fn("SessionHosts.close")(function* (
        key: string,
        host: SessionHost,
        closure?: SessionClosure,
      ) {
        if (hosts.get(key) !== host) return;
        exits.set(key, yield* host.close(closure));
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

      const start = (spec: OpenSpec, creation?: Creation): Effect.Effect<Opened, PiSessionError> =>
        resolved(
          spec.cwd,
          spec.sessionId,
          ({ key, ref, host: existing }) =>
            Effect.gen(function* () {
              if (stopping) return yield* rejected("Piano is shutting down.");
              if (ref.checkoutMissing) return yield* checkoutMissing;
              if (existing) return { session: existing.session, launched: false };
              if (creation)
                yield* registry
                  .addSession(ref.cwd, spec.sessionId, spec.name, creation.projectId)
                  .pipe(Effect.mapError((e) => rejected(e.detail)));
              const lock = yield* lockFor(key);
              const host: SessionHost = yield* makeSessionHost({
                spec: { ...spec, cwd: ref.cwd, sessionFile: ref.file, lastKnownStats: ref.stats },
                lock,
                onChange: announce,
                // Retire only this incarnation. A late event must never close a replacement.
                // The observer reaches this only after taking the lock this open holds.
                onExit: (closure) =>
                  owned(
                    Semaphore.withPermits(lock, 1)(Effect.suspend(() => close(key, host, closure))),
                  ),
              }).pipe(Scope.provide(layerScope), Effect.provideContext(hostServices));
              hosts.set(key, host);
              if (stopping) {
                yield* close(key, host);
                return yield* rejected("Piano is shutting down.");
              }
              yield* announce;
              return { session: host.session, launched: true };
            }),
          creation !== undefined,
        );
      const open = (spec: OpenSpec) => start(spec).pipe(Effect.map(({ session }) => session));

      const create = Effect.fn("SessionHosts.create")(function* (spec: CreateSpec) {
        // Registry writes run before the ownership lock; an unavailable project registers nothing.
        if (spec.projectId !== undefined) yield* registry.requireActiveProject(spec.projectId);
        const cwd = yield* registry.ensureFolder(spec.cwd);
        const { model, thinkingLevel, name, dispatchedFrom } = spec.options;
        // Only a fresh server-generated ID may create a reference. Registration and initial
        // membership survive a disconnected requester, as acquisition is server-owned.
        const { session } = yield* start(
          { cwd, sessionId: randomUUID(), model, thinkingLevel, name, dispatchedFrom },
          { projectId: spec.projectId },
        );
        return session;
      });

      const get = (cwd: string, id: string) =>
        resolved(cwd, id, ({ host }) => Effect.succeed(host?.session));

      // Pi is read outside the ownership lock, as input runs. `get` has already stopped a host
      // whose checkout is gone, and a query writes nothing, so the checkout is not re-checked.
      const commands = Effect.fn("SessionHosts.commands")(
        function* (cwd: string, sessionId: string) {
          const session = yield* get(cwd, sessionId);
          if (!session)
            return yield* new SessionCommandsError({
              detail: "Session is no longer running. Reopen the suggestions.",
            });
          return yield* session.commands;
        },
        // Pi's own error text is not for people here; they can only retry.
        Effect.catchTag("PiSessionError", () =>
          Effect.fail(
            new SessionCommandsError({
              detail: "Could not load commands. Reopen the suggestions to retry.",
            }),
          ),
        ),
      );

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
                if (hosts.get(key) === host && (yield* host.idle(options.idleMs)))
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
        start: (spec) => start(spec),
        commands,
        create,
        rename,
        release,
        get,
        peek: (cwd, id) =>
          resolved(cwd, id, ({ key, ref }) =>
            Effect.gen(function* () {
              const snapshot = yield* references.peek(ref);
              yield* mirrorSession(registry, ref.cwd, id, {
                sessionName: snapshot.state.sessionName,
              });
              return {
                cwd: ref.cwd,
                snapshot: { ...snapshot, state: { ...snapshot.state, closure: exits.get(key) } },
              };
            }),
          ),
        exportBranch: (cwd, id) =>
          resolved(cwd, id, ({ ref, host }) =>
            Effect.gen(function* () {
              if (host && (yield* host.busy))
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
  ).pipe(Layer.provideMerge(SessionReferencesLive), Layer.provideMerge(NotificationsLive));
