import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { Context, Data, Effect, Fiber, Layer, PubSub, Scope, Semaphore, Stream } from "effect";
import {
  type HostInfo,
  type SessionClosure,
  type SlashCommand,
  type Snapshot,
  type StartOptions,
  sameSession,
  SLASH_COMMANDS_TIMEOUT_MS,
  sessionKey,
  type WorktreeRequest,
} from "../../../shared/wire.ts";
import { requireDirectory } from "../../shared/Directory.ts";
import { directoryPath } from "../../shared/PiEnv.ts";
import {
  archivable,
  inOpenFolder,
  Registry,
  RegistryError,
  type SessionEntry,
  sessionById,
} from "../../shared/registry/Registry.ts";
import type { Webhooks } from "../webhooks/Webhooks.ts";
import { FolderWorktrees } from "../workspace/worktrees/FolderWorktrees.ts";
import { mainCheckoutOf, WorktreeError, worktreeOwner } from "../workspace/worktrees/Worktrees.ts";
import type { StartingAttempt } from "./CreationAttempts.ts";
import { type PiSession, PiSessionError, type PiSessions } from "./pi/PiSessions.ts";
import {
  type CloseHow,
  listedFacts,
  makeSessionHost,
  mirrorSession,
  type SessionHost,
} from "./SessionHost.ts";
import { checkoutMissing, type SessionLocation, SessionReferences } from "./SessionReferences.ts";

export interface OpenSpec {
  readonly cwd: string;
  readonly sessionId: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly name?: string;
  readonly dispatchedFrom?: string;
}
export interface Opened {
  readonly session: PiSession;
  readonly launched: boolean;
}
export type SessionReadback =
  | { readonly _tag: "live"; readonly session: PiSession }
  | { readonly _tag: "saved"; readonly cwd: string; readonly snapshot: Snapshot };
export interface CreateSpec {
  readonly attempt?: StartingAttempt;
  readonly cwd: string;
  readonly projectId?: string;
  readonly inheritProject?: boolean;
  readonly options: StartOptions;
  readonly worktree?: WorktreeRequest;
}
interface Creation {
  readonly projectId?: string;
}
interface Resolved {
  readonly key: string;
  readonly ref: SessionLocation;
  readonly host: SessionHost | undefined;
}
export class SessionNotCreated extends Data.TaggedError("SessionNotCreated")<{
  readonly detail: string;
  readonly checkoutUnconfirmed: boolean;
}> {}
export class SessionCommandsError extends Data.TaggedError("SessionCommandsError")<{
  readonly detail: string;
}> {}

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });
const notCreated = (e: PiSessionError) =>
  new SessionNotCreated({ detail: e.detail, checkoutUnconfirmed: false });
const reopenFailed = (e: PiSessionError) => e;

export class SessionHosts extends Context.Service<
  SessionHosts,
  {
    readonly get: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<PiSession | undefined, PiSessionError>;
    readonly open: (spec: OpenSpec) => Effect.Effect<PiSession, PiSessionError>;
    readonly start: (spec: OpenSpec) => Effect.Effect<Opened, PiSessionError>;
    readonly commands: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<ReadonlyArray<SlashCommand>, SessionCommandsError>;
    readonly create: (
      spec: CreateSpec,
    ) => Effect.Effect<PiSession, PiSessionError | SessionNotCreated>;
    readonly rename: (
      cwd: string,
      sessionId: string,
      title: string,
    ) => Effect.Effect<string, PiSessionError | RegistryError>;
    readonly release: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    readonly read: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<SessionReadback, PiSessionError>;
    readonly checkoutMissing: (cwd: string) => Effect.Effect<boolean, PiSessionError>;
    readonly archive: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    readonly delete: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    readonly unarchive: (cwd: string, sessionId: string) => Effect.Effect<boolean, PiSessionError>;
    readonly archiveAll: Effect.Effect<number, RegistryError>;
    readonly archiveCount: Effect.Effect<number, RegistryError>;
    readonly list: Effect.Effect<ReadonlyArray<HostInfo>>;
    readonly subscribe: Effect.Effect<Stream.Stream<ReadonlyArray<HostInfo>>, never, Scope.Scope>;
    readonly lifecycleChanges: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
  }
>()("piano/SessionHosts") {}

export const SessionHostsLive = (options: { idleMs: number }) =>
  Layer.effect(
    SessionHosts,
    Effect.gen(function* () {
      const registry = yield* Registry;
      const references = yield* SessionReferences;
      const worktrees = yield* FolderWorktrees;
      const layerScope = yield* Effect.scope;
      const hostServices = yield* Effect.context<
        PiSessions | Registry | SessionReferences | Webhooks
      >();
      const hosts = new Map<string, SessionHost>();
      const starting = new Map<string, HostInfo>();
      const locks = new Map<string, Semaphore.Semaphore>();
      const exits = new Map<string, SessionClosure>();
      const changed = yield* PubSub.sliding<ReadonlyArray<HostInfo>>(1);
      const lifecycle = yield* PubSub.sliding<void>(1);
      const invalidateHistory = PubSub.publish(lifecycle, undefined).pipe(Effect.asVoid);
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
        { abandonable = false }: { abandonable?: boolean } = {},
      ) => {
        const locked = Effect.gen(function* () {
          const { physical } = yield* references.checkout(cwd);
          const key = sessionKey(physical, sessionId);
          const lock = yield* lockFor(key);
          const held = Effect.suspend(() => work(key));
          return yield* Semaphore.withPermits(
            lock,
            1,
          )(abandonable ? Effect.uninterruptible(held) : held);
        });
        return abandonable ? locked : owned(locked);
      };

      const list = Effect.gen(function* () {
        const live = new Set([...hosts.values()].map((h) => h.session.spec.sessionId));
        const out: HostInfo[] = [...starting.values()].filter((info) => !live.has(info.sessionId));
        for (const h of hosts.values()) {
          const state = yield* h.session.state;
          if (h.closing || state.closure) continue;
          out.push({
            cwd: h.session.spec.cwd,
            sessionId: h.session.spec.sessionId,
            ...listedFacts(state),
          });
        }
        return out;
      });
      const announce = list.pipe(
        Effect.flatMap((l) => PubSub.publish(changed, l)),
        Effect.asVoid,
      );

      const close = Effect.fn("SessionHosts.close")(function* (
        key: string,
        host: SessionHost,
        how?: CloseHow,
      ) {
        if (hosts.get(key) !== host) return;
        exits.set(key, yield* host.close(how));
        hosts.delete(key);
        yield* invalidateHistory;
        yield* announce;
      }, Effect.uninterruptible);

      const resolved = <A, E>(
        cwd: string,
        id: string,
        work: (r: Resolved) => Effect.Effect<A, E>,
        {
          create = false,
          how,
          abandonable,
        }: { create?: boolean; how?: CloseHow; abandonable?: boolean } = {},
      ) =>
        keyed(
          cwd,
          id,
          (key) =>
            Effect.gen(function* () {
              const fresh = create && !hosts.has(key);
              let ref = yield* references.resolve(cwd, id, { create: fresh });
              let host = hosts.get(key);
              if (host && (ref.checkoutMissing || (yield* host.session.state).closure)) {
                yield* close(key, host, how);
                host = undefined;
                ref = yield* references.resolve(cwd, id);
              }
              return yield* work({ key, ref, host });
            }),
          { abandonable },
        );

      const start = <E>(
        spec: OpenSpec,
        refuse: (e: PiSessionError) => E,
        creation?: Creation,
      ): Effect.Effect<Opened, PiSessionError | E> => {
        let registered = false;
        return resolved(
          spec.cwd,
          spec.sessionId,
          ({ key, ref, host: existing }) =>
            Effect.gen(function* () {
              if (stopping) return yield* rejected("Piano is shutting down.");
              if (ref.checkoutMissing) return yield* checkoutMissing;
              if (existing) return { session: existing.session, launched: false };
              const doneAt =
                creation?.projectId === undefined
                  ? undefined
                  : (yield* registry.get).projects.find((p) => p.id === creation.projectId)?.doneAt;
              if (creation)
                yield* registry
                  .addSession(ref.cwd, spec.sessionId, spec.name, creation.projectId)
                  .pipe(Effect.mapError((e) => rejected(e.detail)));
              registered = true;
              const lock = yield* lockFor(key);
              const data = yield* registry.get;
              const projectId = data.sessions.find((s) =>
                sameSession(s, { cwd: ref.cwd, sessionId: spec.sessionId }),
              )?.projectId;
              const projectInstructions = data.projects.find(
                (p) => p.id === projectId,
              )?.instructions;
              const host: SessionHost = yield* makeSessionHost({
                spec: {
                  ...spec,
                  cwd: ref.cwd,
                  sessionFile: ref.file,
                  lastKnownStats: ref.stats,
                  projectInstructions,
                },
                lock,
                onChange: announce,
                onExit: (closure) =>
                  owned(
                    Semaphore.withPermits(
                      lock,
                      1,
                    )(Effect.suspend(() => close(key, host, { closure }))),
                  ),
              }).pipe(
                Scope.provide(layerScope),
                Effect.provideContext(hostServices),
                Effect.onError(() => invalidateHistory),
                Effect.catchTag("PiSessionError", (error) =>
                  Effect.gen(function* () {
                    if (creation && error.startupStopped) {
                      const inspected = yield* references
                        .resolve(ref.cwd, spec.sessionId, { confirmAbsent: true })
                        .pipe(Effect.orElseSucceed(() => undefined));
                      if (inspected && !inspected.file) {
                        yield* registry
                          .removeSession(
                            ref.cwd,
                            spec.sessionId,
                            creation.projectId !== undefined && doneAt !== undefined
                              ? { projectId: creation.projectId, doneAt }
                              : undefined,
                          )
                          .pipe(Effect.mapError((e) => rejected(e.detail)));
                        return yield* Effect.fail(refuse(error));
                      }
                    }
                    return yield* error;
                  }),
                ),
              );
              hosts.set(key, host);
              yield* invalidateHistory;
              if (stopping) {
                yield* close(key, host);
                return yield* rejected("Piano is shutting down.");
              }
              yield* announce;
              return { session: host.session, launched: true };
            }),
          { create: creation !== undefined },
        ).pipe(
          Effect.mapError((e) => (!registered && e instanceof PiSessionError ? refuse(e) : e)),
        );
      };
      const open = (spec: OpenSpec) =>
        start(spec, reopenFailed).pipe(Effect.map(({ session }) => session));

      const physicalPath = (path: string) =>
        Effect.promise(() => realpath(path).catch(() => undefined));

      const registeredAs = (paths: ReadonlyArray<string>, physical: string) =>
        Effect.forEach(paths, physicalPath).pipe(
          Effect.map((real) => paths.find((path, i) => path === physical || real[i] === physical)),
        );

      const registeredFolder = Effect.fn("SessionHosts.registeredFolder")(function* (
        physical: string,
      ) {
        const data = yield* registry.get;
        const closed = data.workspaces
          .filter((w) => w.folder === w.path && !data.folders.includes(w.path))
          .map((w) => w.path);
        const folder = yield* registeredAs([...data.folders, ...closed], physical);
        return folder && !data.folders.includes(folder)
          ? yield* registry.addFolder(folder)
          : folder;
      });

      const folderOf = Effect.fn("SessionHosts.folderOf")(function* (main: string) {
        return (yield* registeredFolder(main)) ?? (yield* registry.addFolder(main));
      });

      const place = Effect.fn("SessionHosts.place")(function* (raw: string) {
        const path = directoryPath(raw);
        yield* requireDirectory(path).pipe(
          Effect.mapError((e) => new RegistryError({ detail: e.detail })),
        );
        const physical = (yield* physicalPath(path)) ?? path;
        const data = yield* registry.get;
        const open = yield* registeredAs(data.folders, physical);
        if (open) return open;
        const worktree = yield* registeredAs(
          data.worktrees.map((w) => w.path),
          physical,
        );
        const entry = data.worktrees.find((w) => w.path === worktree);
        if (entry) {
          yield* registry.addFolder(entry.folder);
          return entry.path;
        }
        const folder = yield* registeredFolder(physical);
        if (folder) return folder;
        const owner = yield* worktreeOwner(path).pipe(
          Effect.mapError((e) => rejected(`Cannot read the checkout ${path}: ${e.detail}`)),
        );
        if (!owner) return yield* registry.addFolder(path);
        yield* registry.addWorktree({
          folder: yield* folderOf(owner.main),
          path: owner.root,
          branch: owner.branch ?? "",
        });
        return owner.root;
      });

      const placeWorktree = Effect.fn("SessionHosts.placeWorktree")(function* (
        raw: string,
        worktree: WorktreeRequest,
      ) {
        const path = directoryPath(raw);
        yield* requireDirectory(path).pipe(
          Effect.mapError((e) => new WorktreeError({ detail: e.detail })),
        );
        const main = yield* mainCheckoutOf(path);
        if (!main)
          return yield* new WorktreeError({
            detail: `${path} is not a Git checkout, so no worktree can be created from it.`,
          });
        const folder = yield* folderOf(main).pipe(
          Effect.mapError((e) => new WorktreeError({ detail: e.detail })),
        );
        const created = yield* worktrees.create(folder, worktree.branch);
        return created.path;
      });

      const destination = Effect.fn("SessionHosts.destination")(
        function* (spec: CreateSpec) {
          if (spec.projectId !== undefined) yield* registry.requireProject(spec.projectId);
          return spec.worktree
            ? yield* placeWorktree(spec.cwd, spec.worktree)
            : yield* place(spec.cwd);
        },
        Effect.mapError(
          (e) =>
            new SessionNotCreated({
              detail: e.detail,
              checkoutUnconfirmed: e instanceof WorktreeError && e.unconfirmed === true,
            }),
        ),
      );

      const create = Effect.fn("SessionHosts.create")(function* (spec: CreateSpec) {
        const { model, thinkingLevel, name, dispatchedFrom } = spec.options;
        let projectId = spec.projectId;
        if (
          projectId === undefined &&
          spec.inheritProject !== false &&
          dispatchedFrom !== undefined
        ) {
          const parent = sessionById(yield* registry.get, dispatchedFrom);
          if (parent._tag !== "unique")
            return yield* new SessionNotCreated({
              detail:
                "Cannot inherit project: parent session is unlisted or ambiguous. Choose a listed parent or set inheritProject to false to start ungrouped.",
              checkoutUnconfirmed: false,
            });
          projectId = parent.entry.projectId;
        }
        const cwd = yield* destination({ ...spec, projectId });
        const kept = (error: SessionNotCreated) =>
          spec.worktree
            ? new SessionNotCreated({
                ...error,
                detail: `${error.detail} The worktree at ${cwd} was created and kept. Retry in that worktree, not by creating the branch again.`,
              })
            : error;
        const sessionId = spec.attempt?.sessionId ?? randomUUID();
        if (spec.attempt)
          yield* spec.attempt
            .place(cwd)
            .pipe(Effect.mapError((e) => kept(notCreated(rejected(e.detail)))));
        starting.set(sessionId, { cwd, sessionId, working: false, starting: true });
        yield* announce;
        const { session } = yield* start(
          { cwd, sessionId, model, thinkingLevel, name, dispatchedFrom },
          notCreated,
          { projectId },
        ).pipe(
          Effect.mapError((error) => (error instanceof SessionNotCreated ? kept(error) : error)),
          Effect.ensuring(
            Effect.sync(() => {
              starting.delete(sessionId);
            }).pipe(Effect.andThen(announce)),
          ),
        );
        return session;
      }, owned);

      const get = (cwd: string, id: string) =>
        resolved(cwd, id, ({ host }) => Effect.succeed(host?.session));

      const read = Effect.fn("SessionHosts.read")(function* (
        cwd: string,
        id: string,
      ): Effect.fn.Return<SessionReadback, PiSessionError> {
        return yield* resolved(
          cwd,
          id,
          ({ key, ref, host }) =>
            Effect.gen(function* (): Effect.fn.Return<SessionReadback> {
              if (host) return { _tag: "live", session: host.session };
              const snapshot = yield* references.peek(ref);
              yield* mirrorSession(registry, ref.cwd, id, {
                sessionName: snapshot.state.sessionName,
              });
              return {
                _tag: "saved",
                cwd: ref.cwd,
                snapshot: { ...snapshot, state: { ...snapshot.state, closure: exits.get(key) } },
              };
            }),
          { abandonable: true },
        );
      });

      const commands = Effect.fn("SessionHosts.commands")(
        function* (cwd: string, sessionId: string) {
          const session = yield* get(cwd, sessionId);
          if (!session)
            return yield* new SessionCommandsError({
              detail: "Session is no longer running. Reopen the suggestions.",
            });
          return yield* session.commands.pipe(
            Effect.timeoutOrElse({
              duration: SLASH_COMMANDS_TIMEOUT_MS,
              orElse: () =>
                Effect.fail(
                  new SessionCommandsError({
                    detail: "Could not load commands. Reopen the suggestions to retry.",
                  }),
                ),
            }),
          );
        },
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
        resolved(
          cwd,
          id,
          ({ key, ref, host }) =>
            Effect.gen(function* () {
              const final = host
                ? yield* close(key, host, { requested: true }).pipe(
                    Effect.andThen(references.resolve(ref.cwd, id)),
                  )
                : ref;
              yield* remove ? references.remove(final) : references.archive(final);
            }),
          { how: { requested: true } },
        );

      const archiveCandidates = Effect.fn("SessionHosts.archiveCandidates")(function* (
        write: boolean,
      ) {
        const candidates: SessionEntry[] = [];
        for (const { key, entry } of yield* references.canonical) {
          if (!archivable(entry) || hosts.has(key) || starting.has(entry.sessionId)) continue;
          const lock = yield* lockFor(key);
          const acquired = yield* Effect.acquireRelease(lock.takeIfAvailable(1), (held) =>
            held ? lock.release(1) : Effect.void,
          );
          if (acquired && !hosts.has(key) && !starting.has(entry.sessionId)) candidates.push(entry);
        }
        return yield* write
          ? registry.archiveSessions(candidates)
          : registry.archivableCount(candidates);
      }, Effect.scoped);

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
        start: (spec) => start(spec, reopenFailed),
        commands,
        create,
        rename,
        release,
        get,
        read,
        checkoutMissing: (cwd) => Effect.map(references.checkout(cwd), ({ missing }) => missing),
        archive: (cwd, id) => retire(cwd, id, false),
        delete: (cwd, id) => retire(cwd, id, true),
        unarchive: (cwd, id) =>
          keyed(cwd, id, () =>
            Effect.gen(function* () {
              const owner = yield* references.unarchive(cwd, id);
              return !inOpenFolder(yield* registry.get, owner);
            }),
          ),
        archiveAll: owned(archiveCandidates(true)),
        archiveCount: archiveCandidates(false),
        list,
        subscribe: Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changed);
          return Stream.concat(Stream.make(yield* list), Stream.fromSubscription(subscription));
        }),
        lifecycleChanges: Effect.map(PubSub.subscribe(lifecycle), Stream.fromSubscription),
      });
    }),
  );
