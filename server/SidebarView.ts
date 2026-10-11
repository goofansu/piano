/**
 * The sidebar view every browser shows: registered folders with their Git worktrees and
 * sessions, projects, workspaces and session references. One instance builds and publishes it
 * for all connections. It hears registry writes from the registry itself, so whoever writes
 * (a browser request, a Pi rename mirrored by SessionHosts) needs no publish step of its own.
 *
 * Registry (INV-01) and running hosts are read on every publish. Git worktree discovery (INV-06)
 * and Pi history listings are the slow observations: they run single-flight in the background,
 * and changes that arrive during a run cause at most one more. A change that keeps the set of
 * registered folders and worktrees publishes at once from the last observation, so a prompt or
 * rename never waits on Git.
 */
import { existsSync } from "node:fs";
import { Context, Deferred, Effect, Layer, PubSub, type Scope, Semaphore, Stream } from "effect";
import type { FolderView, HostInfo, ServerMessage, SessionInfo, SessionReference, WorktreeDiscovery, WorktreeView } from "../shared/wire.ts";
import { projectTrust } from "./ProjectTrust.ts";
import { Registry, type RegistryData } from "./Registry.ts";
import { listSessions } from "./SessionFiles.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { listWorktrees } from "./Worktrees.ts";

export type SidebarMessage = Extract<ServerMessage, { _tag: "registry" }>;

export class SidebarView extends Context.Service<SidebarView, {
  /**
   * Something the view shows from outside the registry changed, such as Pi project trust.
   * Registry writes announce themselves. Publishes promptly when no folder or worktree was
   * added or removed, then rediscovers in the background. Never waits on Git.
   */
  readonly changed: Effect.Effect<void>;
  /** Rediscover in the background, for facts that change outside Piano (a page load, a Refresh). */
  readonly refresh: Effect.Effect<void>;
  /** The latest view, if one exists, then every later one. Subscribes now, so nothing published after this returns is missed. */
  readonly subscribe: Effect.Effect<Stream.Stream<SidebarMessage>, never, Scope.Scope>;
  /** A view built from a discovery that started after this call. */
  readonly fresh: Effect.Effect<SidebarMessage>;
}>()("piano/SidebarView") {}

/** The slow facts, as of one discovery run. */
interface Observation {
  /** Registered folders and worktrees the run looked at; a publish from it is current only while these hold. */
  readonly shape: string;
  readonly paths: ReadonlySet<string>;
  readonly discoveries: ReadonlyMap<string, WorktreeDiscovery>;
  /** Pi session IDs with history, per project member directory. */
  readonly histories: ReadonlyMap<string, ReadonlySet<string>>;
}

const shapeOf = (data: RegistryData) => JSON.stringify([data.folders, data.worktrees.map(w => [w.folder, w.path])]);
/** The registry facts the view shows. Cached Pi statistics and pull-request links are not among them. */
const visibleOf = (data: RegistryData) => JSON.stringify({ ...data, sessions: data.sessions.map(({ stats: _stats, pullRequest: _pullRequest, ...shown }) => shown) });

export interface SidebarViewOptions {
  /** Git worktree discovery for one folder; tests replace it to control timing. */
  readonly discover?: (folder: string) => Effect.Effect<WorktreeDiscovery>;
}

export const SidebarViewLive = (options: SidebarViewOptions = {}) => Layer.effect(SidebarView, Effect.gen(function* () {
  const registry = yield* Registry;
  const hosts = yield* SessionHosts;
  const discover = options.discover ?? listWorktrees;
  const layerScope = yield* Effect.scope;
  const pubsub = yield* PubSub.sliding<SidebarMessage>(1);
  // Publishes read the registry under this lock, so they leave in the order they read it.
  const publishing = yield* Semaphore.make(1);

  let latest: SidebarMessage | undefined;
  let observation: Observation | undefined;
  let running = false;
  let dirty = false;
  let started = 0;
  let waiters: Array<{ readonly after: number; readonly done: Deferred.Deferred<void> }> = [];

  const observe = (data: RegistryData) => Effect.gen(function* () {
    const discoveries = new Map(yield* Effect.forEach(data.folders, folder => Effect.map(discover(folder), d => [folder, d] as const), { concurrency: 4 }));
    const members = [...new Set(data.sessions.filter(s => s.projectId).map(s => s.cwd))];
    const histories = new Map(yield* Effect.forEach(members, cwd => Effect.map(listSessions(cwd), list => [cwd, new Set(list.map(h => h.sessionId))] as const), { concurrency: 4 }));
    const paths = new Set([...data.folders, ...data.worktrees.map(w => w.path)]);
    return { shape: shapeOf(data), paths, discoveries, histories } satisfies Observation;
  });

  /** Registry selects directories and sessions; discovery supplies current Git facts, never cached registry branches. */
  const assemble = (data: RegistryData, running: ReadonlyArray<HostInfo>, seen: Observation) => Effect.gen(function* () {
    const hostOf = (cwd: string, sessionId: string) => running.find(h => h.cwd === cwd && h.sessionId === sessionId);
    // A folder added after the run is left out until the next run, which its change already queued.
    const observed = data.folders.flatMap(path => { const d = seen.discoveries.get(path); return d ? [[path, d] as const] : []; });
    const folders = yield* Effect.forEach(observed, ([path, discovery]) => Effect.gen(function* () {
      const paths = [...new Set([path, ...data.worktrees.filter(w => w.folder === path).map(w => w.path)])];
      const worktrees = yield* Effect.forEach(paths, cwd => Effect.map(projectTrust(cwd), (trust): WorktreeView => {
        const facts = discovery.status === "ready" ? discovery.worktrees.find(w => w.path === (cwd === path ? discovery.currentPath : cwd)) : undefined;
        return { workspace: data.workspaces.find(w => w.path === cwd)!, trust, path: cwd, branch: facts?.branch ?? null, root: cwd === path, facts,
          status: facts ? "current" : !seen.paths.has(cwd) ? "unknown" : discovery.status === "ready" ? "missing" : discovery.status === "non-git" && cwd === path ? "non-git" : "unknown" };
      }));
      const branchOf = new Map(worktrees.map(w => [w.path, w.branch]));
      const sessions = data.sessions
        .filter(t => !t.archived && branchOf.has(t.cwd))
        .map((t): SessionInfo => {
          const h = hostOf(t.cwd, t.sessionId);
          return { sessionId: t.sessionId, workspaceId: data.workspaces.find(w => w.path === t.cwd)!.id, cwd: t.cwd, branch: branchOf.get(t.cwd) ?? "",
            title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt, hosted: !!h, streaming: !!h?.streaming };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { path, name: path.split("/").filter(Boolean).pop() ?? path, worktrees, discovery, sessions } satisfies FolderView;
    }));
    // Group references survive closed directories and missing history; discovery never removes them.
    // A member not yet observed counts as available until the next run says otherwise.
    const sessionReferences = data.sessions.map((s): SessionReference => ({ ...s,
      unavailable: !s.projectId || hostOf(s.cwd, s.sessionId) ? undefined
        : seen.histories.get(s.cwd)?.has(s.sessionId) === false ? "history"
        : !existsSync(s.cwd) ? "checkout" : undefined,
    }));
    return { _tag: "registry", folders, projects: data.projects, sessionReferences, workspaces: data.workspaces } satisfies SidebarMessage;
  });

  /** Publish from the current registry and the last observation; `sameShape` skips it when that observation no longer covers the registry. */
  const publish = (sameShape: boolean) => Semaphore.withPermits(publishing, 1)(Effect.gen(function* () {
    const seen = observation;
    if (!seen) return;
    const data = yield* registry.get;
    if (sameShape && shapeOf(data) !== seen.shape) return;
    const message = yield* assemble(data, yield* hosts.list, seen);
    latest = message;
    yield* PubSub.publish(pubsub, message);
  }));

  const runs: Effect.Effect<void> = Effect.gen(function* () {
    while (true) {
      const run = yield* Effect.sync(() => {
        if (!dirty) { running = false; return 0; }
        dirty = false;
        return ++started;
      });
      if (!run) return;
      yield* Effect.gen(function* () {
        observation = yield* observe(yield* registry.get);
        yield* publish(false);
      }).pipe(Effect.catchCause(cause => Effect.logWarning("sidebar discovery failed", cause)));
      const done = waiters.filter(w => w.after < run);
      waiters = waiters.filter(w => w.after >= run);
      yield* Effect.forEach(done, w => Deferred.succeed(w.done, undefined));
    }
  });

  /** Marks the view dirty and starts a run unless one is going; `done` resolves after a run that starts from now. */
  const request = (done?: Deferred.Deferred<void>) => Effect.suspend(() => {
    dirty = true;
    if (done) waiters.push({ after: started, done });
    if (running) return Effect.void;
    running = true;
    return Effect.asVoid(Effect.forkIn(runs, layerScope));
  });

  const changed = publish(true).pipe(Effect.andThen(request()));
  // Awaited by the writer, so a session reference is on its way to browsers before its prompt reaches Pi.
  // A statistics or pull-request cache write changes nothing shown and must not start a Git run.
  yield* registry.onChange((before, after) => visibleOf(before) === visibleOf(after) ? Effect.void : changed);
  yield* request();

  return SidebarView.of({
    changed,
    refresh: request(),
    subscribe: PubSub.subscribe(pubsub).pipe(Effect.map(subscription => {
      const now = latest;
      return Stream.concat(now ? Stream.make(now) : Stream.empty, Stream.fromSubscription(subscription));
    })),
    fresh: Effect.gen(function* () {
      const done = yield* Deferred.make<void>();
      yield* request(done);
      yield* Deferred.await(done);
      return latest ?? { _tag: "registry", folders: [] };
    }),
  });
}));
