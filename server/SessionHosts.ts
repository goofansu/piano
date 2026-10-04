/**
 * At most one running PiSession per (cwd, sessionId). Hosts outlive browser
 * clients. A host that has been idle (no turn running, no dialog waiting)
 * for a while is released, whether or not a tab is looking at it, since the
 * session file holds all state and a restart costs half a second.
 */
import { Context, Effect, Exit, Layer, PubSub, Ref, Scope, Stream } from "effect";
import type { HostInfo } from "../shared/wire.ts";
import { findSessionFile } from "./SessionFiles.ts";
import { type PiSession, PiSessionError, PiSessions } from "./PiSessions.ts";

export interface OpenSpec {
  readonly cwd: string;
  readonly sessionId: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly name?: string;
}

interface Host {
  readonly session: PiSession;
  readonly scope: Scope.Closeable;
  lastActivity: number;
  readonly openDialogs: Set<string>;
}

export const hostKey = (cwd: string, sessionId: string) => `${cwd}::${sessionId}`;

export class SessionHosts extends Context.Service<
  SessionHosts,
  {
    /** The running session for a key, if any. */
    readonly get: (cwd: string, sessionId: string) => Effect.Effect<PiSession | undefined>;
    /** Start Pi for a session, or return the one already running. */
    readonly open: (spec: OpenSpec) => Effect.Effect<PiSession, PiSessionError>;
    /** Stop Pi for a session; the session file is kept. */
    readonly release: (cwd: string, sessionId: string) => Effect.Effect<void>;
    readonly list: Effect.Effect<ReadonlyArray<HostInfo>>;
    /** Emits whenever the set of hosts or their streaming state changes. */
    readonly changes: Stream.Stream<ReadonlyArray<HostInfo>>;
  }
>()("piano/SessionHosts") {}

export const SessionHostsLive = (options: { idleMs: number }) =>
  Layer.effect(
    SessionHosts,
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const hosts = yield* Ref.make(new Map<string, Host>());
      const changed = yield* PubSub.unbounded<ReadonlyArray<HostInfo>>();
      const layerScope = yield* Effect.scope;

      const list: Effect.Effect<ReadonlyArray<HostInfo>> = Effect.gen(function* () {
        const out: HostInfo[] = [];
        for (const h of (yield* Ref.get(hosts)).values()) {
          const state = yield* h.session.state;
          out.push({ cwd: h.session.spec.cwd, sessionId: h.session.spec.sessionId, streaming: state.isStreaming });
        }
        return out;
      });
      const announce = list.pipe(Effect.flatMap((l) => PubSub.publish(changed, l)), Effect.asVoid);

      const get = (cwd: string, sessionId: string) =>
        Ref.get(hosts).pipe(Effect.map((m) => m.get(hostKey(cwd, sessionId))?.session));

      const release = (cwd: string, sessionId: string) =>
        Effect.gen(function* () {
          const key = hostKey(cwd, sessionId);
          const host = (yield* Ref.get(hosts)).get(key);
          if (!host) return;
          yield* Ref.update(hosts, (m) => {
            const next = new Map(m);
            next.delete(key);
            return next;
          });
          yield* Scope.close(host.scope, Exit.void);
          yield* Effect.logInfo(`released ${sessionId.slice(0, 8)}`);
          yield* announce;
        });

      const open = (spec: OpenSpec) =>
        Effect.gen(function* () {
          const key = hostKey(spec.cwd, spec.sessionId);
          const existing = (yield* Ref.get(hosts)).get(key);
          if (existing) return existing.session;
          const scope = yield* Scope.make();
          const isNew = (yield* findSessionFile(spec.cwd, spec.sessionId)) === undefined;
          const session = yield* sessions
            .open({ cwd: spec.cwd, sessionId: spec.sessionId, model: spec.model, thinkingLevel: spec.thinkingLevel, name: isNew ? spec.name : undefined })
            .pipe(Scope.provide(scope), Effect.tapError(() => Scope.close(scope, Exit.void)));
          const host: Host = { session, scope, lastActivity: Date.now(), openDialogs: new Set() };
          yield* Ref.update(hosts, (m) => new Map(m).set(key, host));
          yield* Effect.logInfo(`started ${spec.sessionId.slice(0, 8)} in ${spec.cwd}${spec.model ? ` (${spec.model})` : ""}`);
          // Track activity and dialogs for idle release; mirror streaming changes and exit into `changes`.
          yield* session.events.pipe(
            Stream.runForEach((e) => {
              host.lastActivity = Date.now();
              if (e._tag === "dialog") host.openDialogs.add(e.dialog.id);
              if (e._tag === "dialog_resolved") host.openDialogs.delete(e.id);
              return e._tag === "state" ? announce : e._tag === "closed" ? release(spec.cwd, spec.sessionId) : Effect.void;
            }),
            Effect.ignore,
            Effect.forkIn(layerScope),
          );
          yield* announce;
          return session;
        });

      // Idle sweeper.
      if (options.idleMs > 0) {
        yield* Effect.gen(function* () {
          const now = Date.now();
          for (const h of (yield* Ref.get(hosts)).values()) {
            if (now - h.lastActivity < options.idleMs || h.openDialogs.size > 0) continue;
            const state = yield* h.session.state;
            if (state.isStreaming || state.queuedMessages?.length) continue;
            yield* Effect.logInfo(`idle ${Math.round((now - h.lastActivity) / 1000)}s, releasing ${h.session.spec.sessionId.slice(0, 8)}`);
            yield* release(h.session.spec.cwd, h.session.spec.sessionId);
          }
        }).pipe(Effect.delay("15 seconds"), Effect.forever, Effect.forkScoped);
      }

      yield* Effect.addFinalizer(() =>
        Ref.get(hosts).pipe(
          Effect.flatMap((m) => Effect.forEach([...m.values()], (h) => Scope.close(h.scope, Exit.void), { discard: true })),
        ),
      );

      return SessionHosts.of({
        get,
        open,
        release,
        list,
        changes: Stream.fromPubSub(changed),
      });
    }),
  );
