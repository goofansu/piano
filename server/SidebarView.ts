/**
 * The sidebar view every browser shows: registered folders with their Git worktrees, projects,
 * workspaces and session references, the one session list. One instance builds and publishes it
 * for all connections. It hears registry writes from the registry itself, so whoever writes
 * (a browser request, a Pi rename mirrored by SessionHosts) needs no publish step of its own.
 *
 * Registry (INV-01) and running hosts are read on every publish. Git worktree discovery (INV-06),
 * session availability (SessionHosts' judgement of Pi history and checkouts) and Pi project trust
 * (through DirectoryFacts) are the observations: discovery runs single-flight in the background,
 * and changes that arrive during a run cause at most one more. A change that keeps the set of
 * registered folders and worktrees publishes at once from the last observation, so a prompt or
 * rename never waits on Git or reads Pi's trust store. DirectoryFacts announces trust decisions;
 * the view re-reads trust then and on each run, so a decision made in a terminal Pi shows after
 * the next run.
 */
import { Context, Deferred, Effect, Layer, PubSub, type Scope, Semaphore, Stream } from "effect";
import type {
  FolderView,
  HostInfo,
  ProjectTrust,
  ServerMessage,
  SessionReference,
  WorktreeDiscovery,
  WorktreeView,
} from "../shared/wire.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { Registry, type RegistryData, shownReference } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { listWorktrees } from "./Worktrees.ts";

export type SidebarMessage = Extract<ServerMessage, { _tag: "registry" }>;

export class SidebarView extends Context.Service<
  SidebarView,
  {
    /** Rediscover in the background, for facts that change outside Piano (a page load, a Refresh). */
    readonly refresh: Effect.Effect<void>;
    /** The latest view, if one exists, then every later one. Subscribes now, so nothing published after this returns is missed. */
    readonly subscribe: Effect.Effect<Stream.Stream<SidebarMessage>, never, Scope.Scope>;
    /** A view built from a discovery that started after this call. */
    readonly fresh: Effect.Effect<SidebarMessage>;
  }
>()("piano/SidebarView") {}

/** The facts from outside the registry, as of one discovery run and any later trust change. */
interface Observation {
  /** Registered folders and worktrees the run looked at; a publish from it is current only while these hold. */
  readonly shape: string;
  readonly paths: ReadonlySet<string>;
  readonly discoveries: ReadonlyMap<string, WorktreeDiscovery>;
  /** Why a project member cannot be opened, as SessionHosts judges it; a member not yet observed is available. */
  readonly unavailable: (cwd: string, sessionId: string) => SessionReference["unavailable"];
  /** Pi's trust for each of `paths`, re-read whenever DirectoryFacts reports a change. */
  readonly trust: ReadonlyMap<string, ProjectTrust>;
}

const shapeOf = (data: RegistryData) =>
  JSON.stringify([data.folders, data.worktrees.map((w) => [w.folder, w.path])]);
/** The registry facts the view shows. Statistics and integration links are not among them. */
const visibleOf = (data: RegistryData) =>
  JSON.stringify({
    ...data,
    sessions: data.sessions.map(shownReference),
  });

export interface SidebarViewOptions {
  /** Git worktree discovery for one folder; tests replace it to control timing. */
  readonly discover?: (folder: string) => Effect.Effect<WorktreeDiscovery>;
}

export const SidebarViewLive = (options: SidebarViewOptions = {}) =>
  Layer.effect(
    SidebarView,
    Effect.gen(function* () {
      const registry = yield* Registry;
      const hosts = yield* SessionHosts;
      const facts = yield* DirectoryFacts;
      const discover = options.discover ?? listWorktrees;
      const layerScope = yield* Effect.scope;
      const pubsub = yield* PubSub.sliding<SidebarMessage>(1);
      // Publishes read the registry under this lock, so they leave in the order they read it.
      // Trust is read and installed under it too, so a later read never loses to an earlier one.
      const publishing = yield* Semaphore.make(1);

      let latest: SidebarMessage | undefined;
      let observation: Observation | undefined;
      let running = false;
      let dirty = false;
      let started = 0;
      let waiters: Array<{ readonly after: number; readonly done: Deferred.Deferred<void> }> = [];

      /** Discovery and availability; trust is read under the publishing lock when this is installed. */
      const observe = Effect.fn("SidebarView.observe")(function* (data: RegistryData) {
        const discoveries = new Map(
          yield* Effect.forEach(
            data.folders,
            (folder) => Effect.map(discover(folder), (d) => [folder, d] as const),
            { concurrency: 4 },
          ),
        );
        const unavailable = yield* hosts.availability(data.sessions.filter((s) => s.projectId));
        const paths = new Set([...data.folders, ...data.worktrees.map((w) => w.path)]);
        return { shape: shapeOf(data), paths, discoveries, unavailable };
      });

      const trustOf = Effect.fn("SidebarView.trustOf")(function* (paths: Iterable<string>) {
        return new Map(
          yield* Effect.forEach(paths, (cwd) =>
            Effect.map(facts.trust(cwd), ({ trust }) => [cwd, trust] as const),
          ),
        );
      });

      /** Registry selects directories and sessions; discovery supplies current Git facts, never cached registry branches. */
      const assemble = Effect.fn("SidebarView.assemble")(function* (
        data: RegistryData,
        running: ReadonlyArray<HostInfo>,
        seen: Observation,
      ) {
        const hosted = (cwd: string, sessionId: string) =>
          running.some((h) => h.cwd === cwd && h.sessionId === sessionId);
        // A folder added after the run is left out until the next run, which its change already queued.
        const observed = data.folders.flatMap((path) => {
          const d = seen.discoveries.get(path);
          return d ? [[path, d] as const] : [];
        });
        const folders = yield* Effect.forEach(observed, ([path, discovery]) =>
          Effect.gen(function* () {
            const paths = [
              ...new Set([
                path,
                ...data.worktrees.filter((w) => w.folder === path).map((w) => w.path),
              ]),
            ];
            // A worktree registered after the run has no observed trust yet; ask Pi for that one.
            const trustAt = (cwd: string) => {
              const known = seen.trust.get(cwd);
              return known ? Effect.succeed(known) : Effect.map(facts.trust(cwd), (d) => d.trust);
            };
            const worktrees = yield* Effect.forEach(paths, (cwd) =>
              Effect.map(trustAt(cwd), (trust): WorktreeView => {
                const facts =
                  discovery.status === "ready"
                    ? discovery.worktrees.find(
                        (w) => w.path === (cwd === path ? discovery.currentPath : cwd),
                      )
                    : undefined;
                return {
                  workspace: data.workspaces.find((w) => w.path === cwd)!,
                  trust,
                  path: cwd,
                  branch: facts?.branch ?? null,
                  root: cwd === path,
                  facts,
                  status: facts
                    ? "current"
                    : !seen.paths.has(cwd)
                      ? "unknown"
                      : discovery.status === "ready"
                        ? "missing"
                        : discovery.status === "non-git" && cwd === path
                          ? "non-git"
                          : "unknown",
                };
              }),
            );
            return {
              path,
              name: path.split("/").filter(Boolean).pop() ?? path,
              worktrees,
              discovery,
            } satisfies FolderView;
          }),
        );
        // A session's branch is its open folder's discovery; a closed folder's session has none known.
        const branchOf = new Map(
          folders.flatMap((f) => f.worktrees.map((w) => [w.path, w.branch] as const)),
        );
        // References survive closed directories and missing history; discovery never removes them.
        // A member not yet observed counts as available until the next run says otherwise.
        const sessionReferences = data.sessions.map(
          (s): SessionReference => ({
            ...shownReference(s),
            workspaceId: data.workspaces.find((w) => w.path === s.cwd)!.id,
            branch: branchOf.get(s.cwd) ?? null,
            unavailable:
              !s.projectId || hosted(s.cwd, s.sessionId)
                ? undefined
                : seen.unavailable(s.cwd, s.sessionId),
          }),
        );
        return {
          _tag: "registry",
          folders,
          projects: data.projects,
          sessionReferences,
          workspaces: data.workspaces,
        } satisfies SidebarMessage;
      });

      const locked = Semaphore.withPermits(publishing, 1);
      /** Publish from the current registry and the last observation; `sameShape` skips it when that observation no longer covers the registry. Holds the lock. */
      const send = Effect.fnUntraced(function* (sameShape: boolean) {
        const seen = observation;
        if (!seen) return;
        const data = yield* registry.get;
        if (sameShape && shapeOf(data) !== seen.shape) return;
        const message = yield* assemble(data, yield* hosts.list, seen);
        latest = message;
        yield* PubSub.publish(pubsub, message);
      });
      const publish = (sameShape: boolean) => locked(send(sameShape));
      /** Install a run's observation with trust read now, then publish from it. */
      const install = (run: Omit<Observation, "trust">) =>
        locked(
          Effect.gen(function* () {
            observation = { ...run, trust: yield* trustOf(run.paths) };
            yield* send(false);
          }),
        );
      /** Pi's resources changed, perhaps trust: re-read it for the observed paths and publish. Git is not asked again. */
      const retrust = locked(
        Effect.gen(function* () {
          const seen = observation;
          if (!seen) return;
          observation = { ...seen, trust: yield* trustOf(seen.paths) };
          yield* send(true);
        }),
      );

      const runs: Effect.Effect<void> = Effect.gen(function* () {
        while (true) {
          const run = yield* Effect.sync(() => {
            if (!dirty) {
              running = false;
              return 0;
            }
            dirty = false;
            return ++started;
          });
          if (!run) return;
          yield* registry.get.pipe(
            Effect.flatMap(observe),
            Effect.flatMap(install),
            Effect.catchCause((cause) => Effect.logWarning("sidebar discovery failed", cause)),
          );
          const done = waiters.filter((w) => w.after < run);
          waiters = waiters.filter((w) => w.after >= run);
          yield* Effect.forEach(done, (w) => Deferred.succeed(w.done, undefined));
        }
      });

      /** Marks the view dirty and starts a run unless one is going; `done` resolves after a run that starts from now. */
      const request = (done?: Deferred.Deferred<void>) =>
        Effect.suspend(() => {
          dirty = true;
          if (done) waiters.push({ after: started, done });
          if (running) return Effect.void;
          running = true;
          return Effect.asVoid(Effect.forkIn(runs, layerScope));
        });

      const changed = publish(true).pipe(Effect.andThen(request()));
      // Awaited by the writer, so a session reference is on its way to browsers before its prompt reaches Pi.
      // Statistics and integration links change nothing shown and must not start a Git run.
      yield* registry.onChange((before, after) =>
        visibleOf(before) === visibleOf(after) ? Effect.void : changed,
      );
      // Started now, so a trust decision made once the layer is built is not missed.
      yield* facts.changes.pipe(
        Stream.runForEach(() =>
          retrust.pipe(
            Effect.catchCause((cause) => Effect.logWarning("sidebar trust update failed", cause)),
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* request();

      return SidebarView.of({
        refresh: request(),
        subscribe: PubSub.subscribe(pubsub).pipe(
          Effect.map((subscription) => {
            const now = latest;
            return Stream.concat(
              now ? Stream.make(now) : Stream.empty,
              Stream.fromSubscription(subscription),
            );
          }),
        ),
        fresh: Effect.gen(function* () {
          const done = yield* Deferred.make<void>();
          yield* request(done);
          yield* Deferred.await(done);
          return latest ?? { _tag: "registry", folders: [] };
        }),
      });
    }),
  );
