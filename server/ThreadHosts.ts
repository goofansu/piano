/**
 * At most one running PiThread per (cwd, sessionId). Hosts outlive browser
 * clients; a host with no attached client and nothing running is released
 * after an idle period, since the session file holds all state.
 */
import { Context, Effect, Exit, Layer, PubSub, Ref, Scope, Stream } from "effect";
import type { HostInfo } from "../shared/wire.ts";
import { findSessionFile } from "./Sessions.ts";
import { type PiThread, PiThreadError, PiThreads } from "./PiThreads.ts";

export interface OpenSpec {
  readonly cwd: string;
  readonly sessionId: string;
  readonly model?: string;
  readonly name?: string;
}

interface Host {
  readonly thread: PiThread;
  readonly scope: Scope.Closeable;
  attached: number;
  idleSince: number;
}

export const hostKey = (cwd: string, sessionId: string) => `${cwd}::${sessionId}`;

export class ThreadHosts extends Context.Service<
  ThreadHosts,
  {
    /** The running thread for a key, if any. */
    readonly get: (cwd: string, sessionId: string) => Effect.Effect<PiThread | undefined>;
    /** Start pi for a thread, or return the one already running. */
    readonly open: (spec: OpenSpec) => Effect.Effect<PiThread, PiThreadError>;
    /** Count a client as attached for the lifetime of the calling Scope (drives idle release). */
    readonly attach: (cwd: string, sessionId: string) => Effect.Effect<void, never, Scope.Scope>;
    /** Stop pi for a thread; the session file is kept. */
    readonly release: (cwd: string, sessionId: string) => Effect.Effect<void>;
    readonly list: Effect.Effect<ReadonlyArray<HostInfo>>;
    /** Emits whenever the set of hosts or their streaming state changes. */
    readonly changes: Stream.Stream<ReadonlyArray<HostInfo>>;
  }
>()("piano/ThreadHosts") {}

export const ThreadHostsLive = (options: { idleMs: number }) =>
  Layer.effect(
    ThreadHosts,
    Effect.gen(function* () {
      const threads = yield* PiThreads;
      const hosts = yield* Ref.make(new Map<string, Host>());
      const changed = yield* PubSub.unbounded<ReadonlyArray<HostInfo>>();
      const layerScope = yield* Effect.scope;

      const list: Effect.Effect<ReadonlyArray<HostInfo>> = Effect.gen(function* () {
        const out: HostInfo[] = [];
        for (const h of (yield* Ref.get(hosts)).values()) {
          const state = yield* h.thread.state;
          out.push({ cwd: h.thread.spec.cwd, sessionId: h.thread.spec.sessionId, streaming: state.isStreaming });
        }
        return out;
      });
      const announce = list.pipe(Effect.flatMap((l) => PubSub.publish(changed, l)), Effect.asVoid);

      const get = (cwd: string, sessionId: string) =>
        Ref.get(hosts).pipe(Effect.map((m) => m.get(hostKey(cwd, sessionId))?.thread));

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
          if (existing) return existing.thread;
          const scope = yield* Scope.make();
          const isNew = (yield* findSessionFile(spec.cwd, spec.sessionId)) === undefined;
          const thread = yield* threads
            .open({ cwd: spec.cwd, sessionId: spec.sessionId, model: spec.model, name: isNew ? spec.name : undefined })
            .pipe(Scope.provide(scope), Effect.tapError(() => Scope.close(scope, Exit.void)));
          const host: Host = { thread, scope, attached: 0, idleSince: Date.now() };
          yield* Ref.update(hosts, (m) => new Map(m).set(key, host));
          yield* Effect.logInfo(`started ${spec.sessionId.slice(0, 8)} in ${spec.cwd}${spec.model ? ` (${spec.model})` : ""}`);
          // Mirror streaming changes and the child's exit into `changes`.
          yield* thread.events.pipe(
            Stream.runForEach((e) =>
              e._tag === "state" ? announce : e._tag === "closed" ? release(spec.cwd, spec.sessionId) : Effect.void,
            ),
            Effect.ignore,
            Effect.forkIn(layerScope),
          );
          yield* announce;
          return thread;
        });

      const attach = (cwd: string, sessionId: string) =>
        Effect.acquireRelease(
          Ref.update(hosts, (m) => {
            const h = m.get(hostKey(cwd, sessionId));
            if (h) h.attached += 1;
            return m;
          }),
          () =>
            Ref.update(hosts, (m) => {
              const h = m.get(hostKey(cwd, sessionId));
              if (h) {
                h.attached -= 1;
                if (h.attached <= 0) h.idleSince = Date.now();
              }
              return m;
            }),
        ).pipe(Effect.asVoid);

      // Idle sweeper.
      if (options.idleMs > 0) {
        yield* Effect.gen(function* () {
          const now = Date.now();
          for (const h of (yield* Ref.get(hosts)).values()) {
            if (h.attached > 0 || now - h.idleSince < options.idleMs) continue;
            const state = yield* h.thread.state;
            if (state.isStreaming) continue;
            yield* Effect.logInfo(`idle ${Math.round((now - h.idleSince) / 60_000)} min`);
            yield* release(h.thread.spec.cwd, h.thread.spec.sessionId);
          }
        }).pipe(Effect.delay("60 seconds"), Effect.forever, Effect.forkScoped);
      }

      yield* Effect.addFinalizer(() =>
        Ref.get(hosts).pipe(
          Effect.flatMap((m) => Effect.forEach([...m.values()], (h) => Scope.close(h.scope, Exit.void), { discard: true })),
        ),
      );

      return ThreadHosts.of({
        get,
        open,
        attach,
        release,
        list,
        changes: Stream.fromPubSub(changed),
      });
    }),
  );
