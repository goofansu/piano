/** Canonical execution ownership. Browser lifetimes never own acquisition or shutdown.
 * Registry references and Pi files keep their original identity; only the ownership
 * key uses realpath. Incompatible alias references fail explicitly, never merge.
 */
import { realpath, rm } from "node:fs/promises";
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, PubSub, Scope, Semaphore, Stream } from "effect";
import { isWorking } from "../shared/sessionProjection.ts";
import type { HostInfo, SessionClosure, SessionStats, Snapshot } from "../shared/wire.ts";
import { directoryPath } from "./PiEnv.ts";
import { type PiSession, PiSessionError, PiSessions } from "./PiSessions.ts";
import { Registry } from "./Registry.ts";
import { emptySnapshot, listSessions, peekSession } from "./SessionFiles.ts";

export interface OpenSpec {
  readonly cwd: string;
  readonly sessionId: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly name?: string;
  /** Only a newly generated server ID may create a registry reference. */
  readonly create?: boolean;
}
interface Host {
  session: PiSession;
  readonly scope: Scope.Closeable;
  lastActivity: number;
  actions: number;
  closing: boolean;
}
/** The registry reference that owns a session's history, with Pi's file when one exists. */
interface Reference {
  readonly cwd: string;
  readonly file: string | undefined;
  readonly stats: SessionStats | undefined;
}
/** A session resolved under its ownership lock. `host` is live: a dead one has been stopped. */
interface Resolved {
  readonly key: string;
  readonly physical: string;
  readonly ref: Reference;
  readonly missing: boolean;
  readonly host: Host | undefined;
}
const hostKey = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });
// A listed Pi file must resolve. Unlike a checkout, it has no missing state or alias memory.
const canonical = (cwd: string) => Effect.tryPromise({
  try: () => realpath(directoryPath(cwd)),
  catch: error => rejected(`Cannot resolve checkout ${cwd}: ${String(error)}`),
});

export class SessionHosts extends Context.Service<SessionHosts, {
  readonly get: (cwd: string, sessionId: string) => Effect.Effect<PiSession | undefined, PiSessionError>;
  readonly open: (spec: OpenSpec) => Effect.Effect<PiSession, PiSessionError>;
  /** Release keeps history and registration; it is not abort-current or archive. */
  readonly release: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
  readonly peek: (cwd: string, sessionId: string) => Effect.Effect<{ cwd: string; snapshot: Snapshot }, PiSessionError>;
  /** Stop, then change retention under the same ownership lock. Stale opens fail. */
  readonly archive: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
  readonly delete: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
  readonly list: Effect.Effect<ReadonlyArray<HostInfo>>;
  readonly changes: Stream.Stream<ReadonlyArray<HostInfo>>;
}>()("piano/SessionHosts") {}

export const SessionHostsLive = (options: { idleMs: number }) => Layer.effect(SessionHosts, Effect.gen(function* () {
  const sessions = yield* PiSessions;
  const registry = yield* Registry;
  const layerScope = yield* Effect.scope;
  const hosts = new Map<string, Host>();
  const locks = new Map<string, Semaphore.Semaphore>();
  // Runtime diagnostics, not a competing history. Retained across child reopen,
  // not across server restart; no execution records are written into registry.
  const exits = new Map<string, SessionClosure>();
  const changed = yield* PubSub.sliding<ReadonlyArray<HostInfo>>(1);
  let stopping = false;
  const lockFor = (key: string) => Effect.sync(() => {
    let lock = locks.get(key);
    if (!lock) { lock = Semaphore.makeUnsafe(1); locks.set(key, lock); }
    return lock;
  });
  // Remember observed aliases for this server lifetime so removing a checkout
  // cannot give an existing child a second ownership key. After restart, missing
  // paths use only their exact registry identity; never guess an alias relationship.
  const identities = new Map<string, string>();
  const checkout = (cwd: string) => Effect.tryPromise({
    try: async () => {
      const path = directoryPath(cwd);
      try {
        const physical = await realpath(path);
        identities.set(path, physical);
        return { physical, missing: false };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return { physical: identities.get(path) ?? path, missing: true };
      }
    },
    catch: error => rejected(`Cannot resolve checkout ${cwd}: ${String(error)}`),
  });
  const checkoutMissing = rejected("This checkout no longer exists. You can read, archive or delete this session. Restore the checkout at its original path before continuing.");
  const requireCheckout = (cwd: string) => checkout(cwd).pipe(Effect.flatMap(({ missing }) => missing ? Effect.fail(checkoutMissing) : Effect.void));
  const owned = <A, E>(work: Effect.Effect<A, E>) => work.pipe(Effect.forkIn(layerScope), Effect.flatMap(Fiber.join));
  const keyed = <A, E>(cwd: string, sessionId: string, work: (key: string, physical: string) => Effect.Effect<A, E>) => owned(Effect.gen(function* () {
    const { physical } = yield* checkout(cwd);
    const key = hostKey(physical, sessionId);
    const lock = yield* lockFor(key);
    return yield* Semaphore.withPermits(lock, 1)(Effect.suspend(() => work(key, physical)));
  }));

  /** Locate old alias-based references without moving or copying Pi history. */
  const reference = Effect.fn("SessionHosts.reference")(function* (cwd: string, sessionId: string, physical: string, create = false): Effect.fn.Return<Reference, PiSessionError> {
    const candidates = (yield* registry.get).sessions.filter(s => s.sessionId === sessionId);
    const matching = [];
    for (const entry of candidates) {
      const path = yield* checkout(entry.cwd).pipe(Effect.map(c => c.physical), Effect.orElseSucceed(() => undefined));
      if (path === physical) matching.push(entry);
    }
    if (matching.length > 1) return yield* rejected(`Conflicting session references for ${sessionId}: ${matching.map(s => s.cwd).join(", ")}. Keep the original references and resolve the duplicate explicitly; Piano has not merged or moved history.`);
    const entry = matching[0];
    if (entry?.archived) return yield* rejected("This session is archived. Start a new session instead.");
    if (!entry && !create) return yield* rejected("This session is no longer registered. Refresh the folder list; deleted sessions cannot be restarted.");
    if (entry && create) return yield* rejected("This session ID is already registered.");
    const owner = entry?.cwd ?? directoryPath(cwd);
    const files = new Map<string, string>();
    for (const path of new Set([owner, directoryPath(cwd), physical])) {
      for (const file of (yield* listSessions(path)).filter(s => s.sessionId === sessionId)) {
        const real = yield* canonical(file.path);
        files.set(real, file.path);
      }
    }
    if (files.size > 1) return yield* rejected(`Conflicting Pi files for checkout aliases (${owner}, ${physical}). Piano has not merged or moved history. Resolve the conflicting session ID before starting it.`);
    return { cwd: owner, file: files.values().next().value as string | undefined, stats: entry?.stats };
  });

  const list = Effect.gen(function* () {
    const out: HostInfo[] = [];
    for (const h of hosts.values()) {
      const state = yield* h.session.state;
      // A disappearing/closing child is not an idle (successfully settled) host.
      if (h.closing || state.closure) continue;
      out.push({ cwd: h.session.spec.cwd, sessionId: h.session.spec.sessionId, streaming: isWorking(state) });
    }
    return out;
  });
  const announce = list.pipe(Effect.flatMap(l => PubSub.publish(changed, l)), Effect.asVoid);

  // Pi owns the session name and statistics; the registry only mirrors them for the sidebar.
  const mirror = (cwd: string, id: string, facts: Parameters<typeof registry.mirrorSession>[2]) => registry.mirrorSession(cwd, id, facts).pipe(
    Effect.catchTag("RegistryError", error => Effect.logWarning(`Could not mirror the session into the registry: ${error.detail}`)));

  const cacheStats = Effect.fn("SessionHosts.cacheStats")(function* (session: PiSession) {
    const state = yield* session.state;
    yield* mirror(session.spec.cwd, session.spec.sessionId, {
      sessionName: state.sessionName,
      stats: state.statsUpdatedAt === undefined ? undefined
        : { context: state.context, cost: state.cost, tokens: state.tokens, statsUpdatedAt: state.statsUpdatedAt },
    });
  });

  // Caller holds this key's lock through actual process exit, not just close intent.
  const close = Effect.fn("SessionHosts.close")(function* (key: string, host: Host, closure?: SessionClosure) {
    if (hosts.get(key) !== host) return;
    host.closing = true;
    yield* Scope.close(host.scope, Exit.void);
    // PiSessions announces how its child stopped, including whether a release interrupted work.
    exits.set(key, closure ?? (yield* host.session.state).closure ?? { _tag: "released", detail: "Pi was released" });
    yield* cacheStats(host.session);
    hosts.delete(key);
    yield* announce;
  }, Effect.uninterruptible);

  /**
   * Resolve a session under its ownership lock, once: its registry reference and Pi file,
   * whether its checkout is missing, and its live host. A caller can beat the event watcher
   * to this lock after Pi exits or the checkout disappears, so a dead host is stopped first
   * and the reference re-read: stopping may persist the Pi file and final statistics.
   */
  const resolved = <A, E>(cwd: string, id: string, work: (r: Resolved) => Effect.Effect<A, E>, create = false) => keyed(cwd, id, (key, physical) => Effect.gen(function* () {
    // Coalesced create calls can share an existing host; registration checks still
    // run for ordinary reopen so archive/delete cannot be undone by a stale tab.
    const fresh = create && !hosts.has(key);
    let ref = yield* reference(cwd, id, physical, fresh);
    const { missing } = yield* checkout(ref.cwd);
    let host = hosts.get(key);
    if (host && (missing || (yield* host.session.state).closure)) {
      yield* close(key, host);
      host = undefined;
      ref = yield* reference(cwd, id, physical);
    }
    return yield* work({ key, physical, ref, missing, host });
  }));

  const open = (spec: OpenSpec) => resolved(spec.cwd, spec.sessionId, ({ key, ref, missing, host: existing }) => Effect.gen(function* () {
    if (stopping) return yield* rejected("Piano is shutting down.");
    if (missing) return yield* checkoutMissing;
    if (existing) return existing.session;
    if (spec.create) yield* registry.addSession(ref.cwd, spec.sessionId, spec.name).pipe(Effect.mapError(e => rejected(e.detail)));
    const scope = yield* Scope.make();
    const raw = yield* sessions.open({ ...spec, cwd: ref.cwd, sessionFile: ref.file, lastKnownStats: ref.stats, name: ref.file ? undefined : spec.name }).pipe(
      Scope.provide(scope), Effect.onExit(exit => Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void),
    );
    if (stopping) {
      yield* Scope.close(scope, Exit.void);
      return yield* rejected("Piano is shutting down.");
    }
    const host: Host = { session: raw, scope, lastActivity: yield* Clock.currentTimeMillis, actions: 0, closing: false };
    const session: PiSession = { ...raw, act: Effect.fn("SessionHosts.act")(function* (action) {
      if (host.closing) return yield* rejected("Pi is closing. Wait for shutdown before reopening history.");
      const lock = yield* lockFor(key);
      // Admit an action atomically against retirement, but don't hold the lock
      // while awaiting a command whose dialog another action must answer.
      const fiber = yield* Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        if (hosts.get(key) !== host || host.closing) return yield* rejected("Pi is closing or has stopped. Refresh before sending new input.");
        if (action._tag !== "abort" && action._tag !== "stop") yield* requireCheckout(raw.spec.cwd);
        host.actions++;
        host.lastActivity = yield* Clock.currentTimeMillis;
        return yield* raw.act(action).pipe(Effect.ensuring(Effect.gen(function* () {
          host.actions--; host.lastActivity = yield* Clock.currentTimeMillis;
        })), Effect.forkIn(scope));
      }));
      return yield* Fiber.join(fiber);
    }) };
    host.session = session;
    hosts.set(key, host);
    yield* cacheStats(session);
    const ready = yield* Deferred.make<void>();
    yield* session.events.pipe(Stream.runForEach(event => Effect.gen(function* () {
      // Signal attachment before taking ownership's lock: open holds it until ready.
      if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
      if (event._tag === "state" || event._tag === "snapshot") {
        const lock = yield* lockFor(key);
        yield* Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
          // Serialize against close/replacement and read current state, not an old
          // queued frame. A retired observer must never overwrite a newer cache.
          if (hosts.get(key) === host && !host.closing) yield* cacheStats(session);
        }));
      }
      host.lastActivity = yield* Clock.currentTimeMillis;
      const closure = event._tag === "closed" ? event.closure : event._tag === "snapshot" ? event.snapshot.state.closure : undefined;
      if (closure) {
        // Retire only this incarnation. A late event must never close a replacement.
        const lock = yield* lockFor(key);
        yield* owned(Semaphore.withPermits(lock, 1)(close(key, host, closure)));
      } else if (event._tag === "state" || event._tag === "snapshot") yield* announce;
    })),
      // The host observer also recaptures after overflow; it must never lose exit
      // ownership just because sidebar observation briefly fell behind.
      Effect.retry({}), Effect.ignore, Effect.forkIn(layerScope));
    yield* Deferred.await(ready);
    yield* announce;
    return session;
  }), spec.create);

  const release = (cwd: string, id: string) => keyed(cwd, id, key => {
    const host = hosts.get(key); return host ? close(key, host) : Effect.void;
  });
  const retire = (cwd: string, id: string, remove: boolean) => resolved(cwd, id, ({ key, physical, ref, host }) => Effect.gen(function* () {
    // Discover the final file AFTER shutdown; a last response may have persisted it.
    const final = host ? yield* close(key, host).pipe(Effect.andThen(reference(ref.cwd, id, physical))) : ref;
    if (remove && final.file) yield* Effect.tryPromise({ try: () => rm(final.file!, { force: true }), catch: error => rejected(`Could not delete Pi history: ${String(error)}`) });
    if (remove) yield* registry.removeSession(ref.cwd, id).pipe(Effect.mapError(e => rejected(e.detail)));
    else yield* registry.archiveSession(ref.cwd, id).pipe(Effect.mapError(e => rejected(e.detail)));
  }));

  if (options.idleMs > 0) yield* Effect.gen(function* () {
    for (const [key, host] of hosts) {
      const lock = yield* lockFor(key);
      yield* Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        if (hosts.get(key) !== host || host.closing || host.actions || (yield* Clock.currentTimeMillis) - host.lastActivity < options.idleMs) return;
        if (!(yield* host.session.state).isQuiescent) return;
        yield* close(key, host);
      }));
    }
  }).pipe(Effect.delay(Math.min(15_000, options.idleMs)), Effect.forever, Effect.forkScoped);

  yield* Effect.addFinalizer(() => Effect.gen(function* () {
    stopping = true;
    for (const [key, host] of hosts) yield* close(key, host);
  }));
  return SessionHosts.of({ open, release,
    get: (cwd, id) => resolved(cwd, id, ({ host }) => Effect.succeed(host?.session)),
    peek: (cwd, id) => resolved(cwd, id, ({ key, ref, missing }) => Effect.gen(function* () {
      const snapshot = ref.file ? yield* peekSession(ref.file, id) : emptySnapshot(id);
      yield* mirror(ref.cwd, id, { sessionName: snapshot.state.sessionName });
      return { cwd: ref.cwd, snapshot: { ...snapshot, state: { ...snapshot.state, ...ref.stats, contextIsLastKnown: true, checkoutMissing: missing, closure: exits.get(key) } } };
    })),
    archive: (cwd, id) => retire(cwd, id, false), delete: (cwd, id) => retire(cwd, id, true),
    list, changes: Stream.fromPubSub(changed),
  });
}));
