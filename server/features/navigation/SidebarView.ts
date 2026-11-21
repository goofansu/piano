import { stat } from "node:fs/promises";
import { Context, Deferred, Effect, Layer, PubSub, type Scope, Semaphore, Stream } from "effect";
import {
  type FolderView,
  type HostInfo,
  type ProjectTrust,
  type ServerMessage,
  type SessionReference,
  sameSession,
  sessionKey,
  type WorktreeDiscovery,
  type WorktreeView,
} from "../../../shared/wire.ts";
import { DirectoryFacts } from "../../shared/DirectoryFacts.ts";
import {
  inOpenFolder,
  Registry,
  type RegistryData,
  shownReference,
} from "../../shared/registry/Registry.ts";
import { SessionHosts } from "../sessions/SessionHosts.ts";
import { SessionReferences } from "../sessions/SessionReferences.ts";
import { listWorktrees } from "../workspace/worktrees/Worktrees.ts";
import { type CoalescedReader, makeCoalescedReader } from "./CoalescedReader.ts";

export type SidebarMessage = Extract<ServerMessage, { _tag: "registry" }>;

export class SidebarView extends Context.Service<
  SidebarView,
  {
    readonly refresh: Effect.Effect<void>;
    readonly subscribe: Effect.Effect<Stream.Stream<SidebarMessage>, never, Scope.Scope>;
    readonly fresh: Effect.Effect<SidebarMessage>;
  }
>()("piano/SidebarView") {}

interface Observation {
  readonly shape: string;
  readonly paths: ReadonlySet<string>;
  readonly discoveries: ReadonlyMap<string, WorktreeDiscovery>;
  readonly gone: ReadonlySet<string>;
  readonly trust: ReadonlyMap<string, ProjectTrust>;
}

const shapeOf = (data: RegistryData) =>
  JSON.stringify([data.folders, data.worktrees.map((w) => [w.folder, w.path])]);
const sessionsOf = (data: RegistryData) =>
  JSON.stringify(data.sessions.map((s) => [s.cwd, s.sessionId]));
const visibleOf = (data: RegistryData) =>
  JSON.stringify({
    ...data,
    sessions: data.sessions.map(shownReference),
  });
const shownAs = (message: SidebarMessage) =>
  JSON.stringify(message, (key, value) => (key === "observedAt" ? undefined : value));

export interface SidebarViewOptions {
  readonly discover?: (folder: string) => Effect.Effect<WorktreeDiscovery>;
}

export const SidebarViewLive = (options: SidebarViewOptions = {}) =>
  Layer.effect(
    SidebarView,
    Effect.gen(function* () {
      const registry = yield* Registry;
      const hosts = yield* SessionHosts;
      const references = yield* SessionReferences;
      const facts = yield* DirectoryFacts;
      const discover = options.discover ?? listWorktrees;
      const layerScope = yield* Effect.scope;
      const pubsub = yield* PubSub.sliding<SidebarMessage>(1);
      const publishing = yield* Semaphore.make(1);

      let latest: SidebarMessage | undefined;
      let published: string | undefined;
      let observation: Observation | undefined;
      let unavailable = new Map<string, SessionReference["unavailable"]>();

      const observe = Effect.fn("SidebarView.observe")(function* (data: RegistryData) {
        const paths = new Set([...data.folders, ...data.worktrees.map((w) => w.path)]);
        const absent = (path: string) =>
          Effect.promise(() =>
            stat(path).then(
              () => false,
              (error: NodeJS.ErrnoException) => error.code === "ENOENT",
            ),
          );
        const [discovered, absence] = yield* Effect.all(
          [
            Effect.forEach(
              data.folders,
              (folder) => Effect.map(discover(folder), (d) => [folder, d] as const),
              { concurrency: 4 },
            ),
            Effect.forEach(paths, (path) => Effect.map(absent(path), (a) => [path, a] as const), {
              concurrency: 4,
            }),
          ],
          { concurrency: 2 },
        );
        const gone = new Set(absence.flatMap(([path, a]) => (a ? [path] : [])));
        return { shape: shapeOf(data), paths, discoveries: new Map(discovered), gone };
      });

      const trustOf = Effect.fn("SidebarView.trustOf")(function* (paths: Iterable<string>) {
        return new Map(
          yield* Effect.forEach(paths, (cwd) =>
            Effect.map(facts.trust(cwd), ({ trust }) => [cwd, trust] as const),
          ),
        );
      });

      const assemble = Effect.fn("SidebarView.assemble")(function* (
        data: RegistryData,
        running: ReadonlyArray<HostInfo>,
        seen: Observation,
      ) {
        const hosted = (cwd: string, sessionId: string) =>
          running.some((h) => sameSession(h, { cwd, sessionId }));
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
            const trustAt = (cwd: string) => {
              const known = seen.trust.get(cwd);
              return known ? Effect.succeed(known) : Effect.map(facts.trust(cwd), (d) => d.trust);
            };
            const worktrees = yield* Effect.forEach(paths, (cwd) =>
              Effect.map(trustAt(cwd), (trust): WorktreeView => {
                const gone = seen.gone.has(cwd);
                const facts =
                  !gone && discovery.status === "ready"
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
                  status: gone
                    ? "missing"
                    : facts
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
        const shown = new Map(folders.flatMap((f) => f.worktrees.map((w) => [w.path, w] as const)));
        const registered = new Map(data.worktrees.map((w) => [w.path, w] as const));
        const branchOf = (cwd: string): string | null => {
          const saved = registered.get(cwd)?.branch || null;
          const view = shown.get(cwd);
          if (view)
            return view.status === "current"
              ? view.branch
              : view.status === "missing"
                ? saved
                : null;
          return inOpenFolder(data, cwd) ? null : saved;
        };
        const sessionReferences = data.sessions.map((s): SessionReference => ({
          ...shownReference(s),
          workspaceId: data.workspaces.find((w) => w.path === s.cwd)!.id,
          branch: branchOf(s.cwd),
          unavailable: hosted(s.cwd, s.sessionId)
            ? undefined
            : unavailable.get(sessionKey(s.cwd, s.sessionId)),
        }));
        return {
          _tag: "registry",
          folders,
          projects: data.projects,
          sessionReferences,
          workspaces: data.workspaces,
        } satisfies SidebarMessage;
      });

      const locked = Semaphore.withPermits(publishing, 1);
      const send = Effect.fnUntraced(function* (sameShape: boolean) {
        const seen = observation;
        if (!seen) return;
        const data = yield* registry.get;
        if (sameShape && shapeOf(data) !== seen.shape) return;
        const message = yield* assemble(data, yield* hosts.list, seen);
        latest = message;
        const shown = shownAs(message);
        if (shown === published) return;
        published = shown;
        yield* PubSub.publish(pubsub, message);
      });
      const publish = (sameShape: boolean) => locked(send(sameShape));
      const install = (run: Omit<Observation, "trust">) =>
        locked(
          Effect.gen(function* () {
            observation = { ...run, trust: yield* trustOf(run.paths) };
            yield* send(false);
          }),
        );
      const retrust = locked(
        Effect.gen(function* () {
          const seen = observation;
          if (!seen) return;
          observation = { ...seen, trust: yield* trustOf(seen.paths) };
          yield* send(true);
        }),
      );

      const branchesOf = (data: RegistryData, run: Omit<Observation, "trust">) =>
        data.worktrees.flatMap((w) => {
          const discovery = run.discoveries.get(w.folder);
          if (discovery?.status !== "ready") return [];
          const path = w.path === w.folder ? discovery.currentPath : w.path;
          const branch = discovery.worktrees.find((f) => f.path === path)?.branch;
          return branch && branch !== w.branch ? [{ path: w.path, branch }] : [];
        });

      const git = makeCoalescedReader({
        name: "sidebar discovery",
        scope: layerScope,
        read: () =>
          Effect.gen(function* () {
            const data = yield* registry.get;
            const run = yield* observe(data);
            yield* install(run);
            const observed = branchesOf(data, run);
            if (observed.length) yield* registry.observeWorktreeBranches(observed);
            return true;
          }),
      });

      const availability: CoalescedReader = makeCoalescedReader({
        name: "sidebar availability",
        scope: layerScope,
        read: (superseded) =>
          Effect.gen(function* () {
            const data = yield* registry.get;
            const sessions = data.sessions;
            const judged = yield* references.availability(sessions);
            return yield* locked(
              Effect.gen(function* () {
                if (superseded()) return false;
                if (sessionsOf(data) !== sessionsOf(yield* registry.get)) {
                  yield* availability.request();
                  return false;
                }
                unavailable = new Map(
                  sessions.map((s) => [sessionKey(s.cwd, s.sessionId), judged(s.cwd, s.sessionId)]),
                );
                yield* send(false);
                return true;
              }),
            );
          }),
      });
      const refresh = git.request().pipe(Effect.andThen(availability.request()));
      yield* registry.onChange((before, after) => {
        if (visibleOf(before) === visibleOf(after)) return Effect.void;
        const shape = shapeOf(before) !== shapeOf(after);
        const sessions = sessionsOf(before) !== sessionsOf(after);
        return publish(true).pipe(
          Effect.andThen(shape ? git.request() : Effect.void),
          Effect.andThen(sessions ? availability.request() : Effect.void),
        );
      });
      yield* (yield* hosts.lifecycleChanges).pipe(
        Stream.runForEach(() => availability.request()),
        Effect.forkScoped,
      );
      yield* (yield* facts.changes).pipe(
        Stream.runForEach(() =>
          retrust.pipe(
            Effect.catchCause((cause) => Effect.logWarning("sidebar trust update failed", cause)),
          ),
        ),
        Effect.forkScoped,
      );
      yield* refresh;

      return SidebarView.of({
        refresh,
        subscribe: locked(
          PubSub.subscribe(pubsub).pipe(
            Effect.map((subscription) => {
              const now = latest;
              return Stream.concat(
                now ? Stream.make(now) : Stream.empty,
                Stream.fromSubscription(subscription),
              );
            }),
          ),
        ),
        fresh: Effect.gen(function* () {
          const done = yield* Deferred.make<void>();
          const available = yield* Deferred.make<void>();
          yield* git.request(done);
          yield* availability.request(available);
          yield* Deferred.await(done);
          yield* Deferred.await(available);
          return latest ?? { _tag: "registry", folders: [] };
        }),
      });
    }),
  );
