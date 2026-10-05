/** Canonical execution ownership. Browser lifetimes never own acquisition or shutdown.
 * Registry references and Pi files keep their original identity; only the ownership
 * key uses realpath. Incompatible alias references fail explicitly, never merge.
 */
import { realpath, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, PubSub, Scope, Semaphore, Stream } from "effect";
import type { HostInfo, Snapshot } from "../shared/wire.ts";
import { expandHome } from "./PiEnv.ts";
import { emptySnapshot, listSessions, peekSession } from "./SessionFiles.ts";
import { type PiSession, PiSessionError, PiSessions } from "./PiSessions.ts";
import { Registry } from "./Registry.ts";

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
const hostKey = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });
const canonical = (cwd: string) => Effect.tryPromise({
  try: () => realpath(resolve(expandHome(cwd))),
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
  const exits = new Map<string, string>();
  const changed = yield* PubSub.sliding<ReadonlyArray<HostInfo>>(1);
  let stopping = false;
  const lockFor = (key: string) => Effect.sync(() => {
    let lock = locks.get(key);
    if (!lock) { lock = Semaphore.makeUnsafe(1); locks.set(key, lock); }
    return lock;
  });
  const owned = <A, E>(work: Effect.Effect<A, E>) => work.pipe(Effect.forkIn(layerScope), Effect.flatMap(Fiber.join));
  const keyed = <A, E>(cwd: string, sessionId: string, work: (key: string, physical: string) => Effect.Effect<A, E>) => owned(Effect.gen(function* () {
    const physical = yield* canonical(cwd);
    const key = hostKey(physical, sessionId);
    const lock = yield* lockFor(key);
    return yield* Semaphore.withPermits(lock, 1)(Effect.suspend(() => work(key, physical)));
  }));

  /** Locate old alias-based references without moving or copying Pi history. */
  const reference = (cwd: string, sessionId: string, physical: string, create = false) => Effect.gen(function* () {
    const candidates = (yield* registry.get).sessions.filter(s => s.sessionId === sessionId);
    const matching = [];
    for (const entry of candidates) {
      const path = yield* canonical(entry.cwd).pipe(Effect.orElseSucceed(() => undefined));
      if (path === physical) matching.push(entry);
    }
    if (matching.length > 1) return yield* rejected(`Conflicting session references for ${sessionId}: ${matching.map(s => s.cwd).join(", ")}. Keep the original references and resolve the duplicate explicitly; Piano has not merged or moved history.`);
    const entry = matching[0];
    if (entry?.archived) return yield* rejected("This session is archived. Start a new session instead.");
    if (!entry && !create) return yield* rejected("This session is no longer registered. Refresh the project list; deleted sessions cannot be restarted.");
    if (entry && create) return yield* rejected("This session ID is already registered.");
    const owner = entry?.cwd ?? resolve(expandHome(cwd));
    const files = new Map<string, string>();
    for (const path of new Set([owner, resolve(expandHome(cwd)), physical])) {
      for (const file of (yield* listSessions(path)).filter(s => s.sessionId === sessionId)) {
        const real = yield* canonical(file.path);
        files.set(real, file.path);
      }
    }
    if (files.size > 1) return yield* rejected(`Conflicting Pi files for checkout aliases (${owner}, ${physical}). Piano has not merged or moved history. Resolve the conflicting session ID before starting it.`);
    return { cwd: owner, file: files.values().next().value as string | undefined };
  });

  const list = Effect.gen(function* () {
    const out: HostInfo[] = [];
    for (const h of hosts.values()) {
      const state = yield* h.session.state;
      // A disappearing/closing child is not an idle (successfully settled) host.
      if (h.closing || state.closedReason) continue;
      out.push({ cwd: h.session.spec.cwd, sessionId: h.session.spec.sessionId,
        streaming: !!(state.isStreaming || state.isCompacting || state.isRetrying) });
    }
    return out;
  });
  const announce = list.pipe(Effect.flatMap(l => PubSub.publish(changed, l)), Effect.asVoid);

  // Caller holds this key's lock through actual process exit, not just close intent.
  const close = (key: string, host: Host, reason?: string) => Effect.gen(function* () {
    if (hosts.get(key) !== host) return;
    host.closing = true;
    const state = yield* host.session.state;
    const detail = reason ?? state.closedReason ?? (state.isQuiescent ? "released" : "Pi was released during work. Interrupted operations were not resumed.");
    exits.set(key, detail);
    yield* Scope.close(host.scope, Exit.void);
    hosts.delete(key);
    yield* announce;
  }).pipe(Effect.uninterruptible);

  const open = (spec: OpenSpec) => keyed(spec.cwd, spec.sessionId, (key, physical) => Effect.gen(function* () {
    if (stopping) return yield* rejected("Piano is shutting down.");
    // Coalesced create calls can share an existing host; registration checks still
    // run for ordinary reopen so archive/delete cannot be undone by a stale tab.
    const ref = yield* reference(spec.cwd, spec.sessionId, physical, spec.create && !hosts.has(key));
    const existing = hosts.get(key);
    if (existing) {
      if (!(yield* existing.session.state).closedReason) return existing.session;
      yield* close(key, existing);
    }
    if (spec.create) yield* registry.addSession(ref.cwd, spec.sessionId, spec.name).pipe(Effect.mapError(e => rejected(e.detail)));
    const scope = yield* Scope.make();
    const raw = yield* sessions.open({ ...spec, cwd: ref.cwd, sessionFile: ref.file, name: ref.file ? undefined : spec.name }).pipe(
      Scope.provide(scope), Effect.onExit(exit => Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void),
    );
    if (stopping) {
      yield* Scope.close(scope, Exit.void);
      return yield* rejected("Piano is shutting down.");
    }
    const host: Host = { session: raw, scope, lastActivity: yield* Clock.currentTimeMillis, actions: 0, closing: false };
    const session: PiSession = { ...raw, act: action => Effect.gen(function* () {
      if (host.closing) return yield* rejected("Pi is closing. Wait for shutdown before reopening history.");
      const lock = yield* lockFor(key);
      // Admit an action atomically against retirement, but don't hold the lock
      // while awaiting a command whose dialog another action must answer.
      const fiber = yield* Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        if (hosts.get(key) !== host || host.closing) return yield* rejected("Pi is closing or has stopped. Refresh before sending new input.");
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
    const ready = yield* Deferred.make<void>();
    yield* session.events.pipe(Stream.runForEach(event => Effect.gen(function* () {
      if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
      host.lastActivity = yield* Clock.currentTimeMillis;
      const reason = event._tag === "closed" ? event.reason : event._tag === "snapshot" ? event.snapshot.state.closedReason : undefined;
      if (reason) {
        // Retire only this incarnation. A late event must never close a replacement.
        const lock = yield* lockFor(key);
        yield* owned(Semaphore.withPermits(lock, 1)(close(key, host, reason)));
      } else if (event._tag === "state" || event._tag === "snapshot") yield* announce;
    })),
      // The host observer also recaptures after overflow; it must never lose exit
      // ownership just because sidebar observation briefly fell behind.
      Effect.retry({}), Effect.ignore, Effect.forkIn(layerScope));
    yield* Deferred.await(ready);
    yield* announce;
    return session;
  }));

  const release = (cwd: string, id: string) => keyed(cwd, id, key => {
    const host = hosts.get(key); return host ? close(key, host) : Effect.void;
  });
  const retire = (cwd: string, id: string, remove: boolean) => keyed(cwd, id, (key, physical) => Effect.gen(function* () {
    const ref = yield* reference(cwd, id, physical);
    const host = hosts.get(key);
    if (host) yield* close(key, host);
    // Discover the final file AFTER shutdown; a last response may have persisted it.
    const final = yield* reference(ref.cwd, id, physical);
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
    get: (cwd, id) => keyed(cwd, id, (key, physical) => Effect.gen(function* () {
      yield* reference(cwd, id, physical);
      const host = hosts.get(key);
      if (host && (yield* host.session.state).closedReason) {
        yield* close(key, host);
        return undefined;
      }
      return host?.session;
    })),
    peek: (cwd, id) => keyed(cwd, id, (key, physical) => Effect.gen(function* () {
      // A caller can beat the event watcher to this lock after Pi exits. Retain
      // the authoritative cause here too, before returning file-only history.
      const host = hosts.get(key);
      if (host && (yield* host.session.state).closedReason) yield* close(key, host);
      const ref = yield* reference(cwd, id, physical);
      const snapshot = ref.file ? yield* peekSession(ref.file, id) : emptySnapshot(id);
      return { cwd: ref.cwd, snapshot: { ...snapshot, state: { ...snapshot.state, closedReason: exits.get(key) } } };
    })),
    archive: (cwd, id) => retire(cwd, id, false), delete: (cwd, id) => retire(cwd, id, true),
    list, changes: Stream.fromPubSub(changed),
  });
}));
