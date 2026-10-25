/** Canonical execution ownership and the session lifecycle around it: create (folder, project
 * and reference before Pi starts), open, rename, release, archive and delete. A SessionHost owns
 * each running session; this module keys hosts, locks keys, and orders retirement. Browser
 * lifetimes never own acquisition or shutdown.
 * SessionReferences finds a session's history and judges whether it can be opened; this module
 * keys ownership by the physical checkout it returns and calls it under that key's lock.
 */
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { Context, Data, Effect, Fiber, Layer, PubSub, Scope, Semaphore, Stream } from "effect";
import { isWorking } from "../shared/sessionProjection.ts";
import {
  type HostInfo,
  type SessionClosure,
  type SlashCommand,
  type Snapshot,
  type StartOptions,
  sameSession,
  sessionKey,
  type WorktreeRequest,
} from "../shared/wire.ts";
import { Directories } from "./Directories.ts";
import { FolderWorktrees, FolderWorktreesLive } from "./FolderWorktrees.ts";
import { directoryPath } from "./PiEnv.ts";
import { type PiSession, PiSessionError, type PiSessions } from "./PiSessions.ts";
import { Registry, RegistryError } from "./Registry.ts";
import { type CloseHow, makeSessionHost, mirrorSession, type SessionHost } from "./SessionHost.ts";
import {
  checkoutMissing,
  type SessionLocation,
  SessionReferences,
  SessionReferencesLive,
} from "./SessionReferences.ts";
import { type Webhooks, WebhooksLive } from "./Webhooks.ts";
import { mainCheckoutOf, WorktreeError, worktreeOwner } from "./Worktrees.ts";

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
/** A validated live attachment target or a saved view, chosen under the ownership lock. */
export type SessionReadback =
  | { readonly _tag: "live"; readonly session: PiSession }
  | { readonly _tag: "saved"; readonly cwd: string; readonly snapshot: Snapshot };
/** A new session in a directory; an unregistered one is placed by `place` first. */
export interface CreateSpec {
  readonly cwd: string;
  /** Initial project; it must be active, checked before anything is registered. */
  readonly projectId?: string;
  readonly options: StartOptions;
  /** Create this new branch's worktree from `cwd`'s repository and start the session there. */
  readonly worktree?: WorktreeRequest;
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
/**
 * A creation that failed before any session was registered or Pi started, so its first message
 * was never sent. `detail` is written for people; `checkoutUnconfirmed` when Worktrunk ran and
 * may have left a checkout behind.
 */
export class SessionNotCreated extends Data.TaggedError("SessionNotCreated")<{
  readonly detail: string;
  readonly checkoutUnconfirmed: boolean;
}> {}
/** Slash commands a session could not answer with; `detail` is written for people. */
export class SessionCommandsError extends Data.TaggedError("SessionCommandsError")<{
  readonly detail: string;
}> {}

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });
/** A creation's failure before its reference is written: nothing registered, Pi never started. */
const notCreated = (e: PiSessionError) =>
  new SessionNotCreated({ detail: e.detail, checkoutUnconfirmed: false });
/** An open's failures stay its own: its reference was written before this call. */
const reopenFailed = (e: PiSessionError) => e;

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
     * Every failure before then is `SessionNotCreated`; a PiSessionError comes once a reference
     * may exist and Pi may have saved history.
     */
    readonly create: (
      spec: CreateSpec,
    ) => Effect.Effect<PiSession, PiSessionError | SessionNotCreated>;
    /** Pi owns the name, so a stopped session is started for it; returns the mirrored title. */
    readonly rename: (
      cwd: string,
      sessionId: string,
      title: string,
    ) => Effect.Effect<string, PiSessionError | RegistryError>;
    /** Release keeps history and registration; it is not abort-current or archive. */
    readonly release: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    /** Resolve once under the ownership lock, returning the live session or reading its saved
     * view before releasing ownership. Never starts Pi. */
    readonly read: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<SessionReadback, PiSessionError>;
    /** Whether the checkout at `cwd` is gone now: one filesystem check, no lock and no Pi. */
    readonly checkoutMissing: (cwd: string) => Effect.Effect<boolean, PiSessionError>;
    /** Capture Pi's saved branch under the ownership lock, without starting a child. */
    readonly exportBranch: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<string, PiSessionError>;
    /** Stop, then change retention under the same ownership lock. Stale opens fail. */
    readonly archive: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    readonly delete: (cwd: string, sessionId: string) => Effect.Effect<void, PiSessionError>;
    readonly list: Effect.Effect<ReadonlyArray<HostInfo>>;
    /** The running sessions, then every later change to them. Subscribes now, so nothing published
     * after this returns is missed. */
    readonly subscribe: Effect.Effect<Stream.Stream<ReadonlyArray<HostInfo>>, never, Scope.Scope>;
    /** Acquisition or completed retirement may have changed Pi history. Coalesced invalidations,
     * not a lifecycle log: re-read current facts. Ordinary session state changes do not emit. */
    readonly lifecycleChanges: Stream.Stream<void>;
  }
>()("piano/SessionHosts") {}

/** Also provides the SessionReferences it keys ownership by, so every caller shares its alias
 * memory, and the FolderWorktrees it creates worktrees through. */
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
      const locks = new Map<string, Semaphore.Semaphore>();
      // Runtime diagnostics, not a competing history. Retained across child reopen,
      // not across server restart; no execution records are written into registry.
      const exits = new Map<string, SessionClosure>();
      const changed = yield* PubSub.sliding<ReadonlyArray<HostInfo>>(1);
      const lifecycle = yield* PubSub.sliding<void>(1);
      // Never await observers under ownership's lock. Even a whole create/retire lifetime can
      // coalesce to one invalidation; unlike diffing host lists, that cannot lose the change.
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
      ) =>
        owned(
          Effect.gen(function* () {
            const { physical } = yield* references.checkout(cwd);
            const key = sessionKey(physical, sessionId);
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
            ...(state.preview && { preview: true }),
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
        how?: CloseHow,
      ) {
        if (hosts.get(key) !== host) return;
        exits.set(key, yield* host.close(how));
        hosts.delete(key);
        yield* invalidateHistory;
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

      /** `refuse` answers every failure before the reference is known to exist, resolution
       * included: for a creation, nothing was registered and Pi never started. */
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
              if (creation)
                yield* registry
                  .addSession(ref.cwd, spec.sessionId, spec.name, creation.projectId)
                  .pipe(Effect.mapError((e) => rejected(e.detail)));
              registered = true;
              const lock = yield* lockFor(key);
              // The project's instructions as of this launch; an edit reaches the next one.
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
                // Retire only this incarnation. A late event must never close a replacement.
                // The observer reaches this only after taking the lock this open holds.
                onExit: (closure) =>
                  owned(
                    Semaphore.withPermits(
                      lock,
                      1,
                    )(Effect.suspend(() => close(key, host, { closure }))),
                  ).pipe(
                    Effect.catchTag("PiSessionError", (error) => Effect.logWarning(error.detail)),
                  ),
              }).pipe(
                Scope.provide(layerScope),
                Effect.provideContext(hostServices),
                // Pi may have saved history before readiness failed. makeSessionHost has
                // closed the failed child's scope before the failure reaches here.
                Effect.onError(() => invalidateHistory),
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
          creation !== undefined,
        ).pipe(Effect.mapError((e) => (registered ? e : refuse(e))));
      };
      const open = (spec: OpenSpec) =>
        start(spec, reopenFailed).pipe(Effect.map(({ session }) => session));

      /**
       * Where a new session's directory belongs: one rule for every spelling of a checkout. Git
       * says what the directory is; Piano decides the placement (INV-01):
       * - a registered worktree starts there, and its folder is reopened if it was closed;
       * - a registered folder, under any spelling of the same directory, starts in that folder
       *   under its registered spelling, so the sidebar lists the session there; a closed folder
       *   is matched the same way and reopened under its registered spelling;
       * - the root of a linked worktree is listed under its main checkout's folder, added when
       *   missing, and recorded under Git's spelling of its path, which discovery matches;
       * - any other directory becomes a folder of its own.
       * A missing directory gets Piano's own answer before Git is asked anything, and a checkout
       * Git cannot read refuses creation instead of registering it blindly (INV-06).
       */
      const physicalPath = (path: string) =>
        Effect.promise(() => realpath(path).catch(() => undefined));

      /** The registered spelling among `paths` of the directory whose physical path is `physical`. */
      const registeredAs = (paths: ReadonlyArray<string>, physical: string) =>
        Effect.forEach(paths, physicalPath).pipe(
          Effect.map((real) => paths.find((path, i) => path === physical || real[i] === physical)),
        );

      /** The registered folder, open or closed, of the directory whose physical path is
       * `physical`, reopened under its registered spelling when it was closed. A closed folder
       * keeps its root workspace (folder === path), so its spelling outlives `folders`; the
       * registry cannot tell it from a session reference's spelling, which is adopted alike. */
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

      /** The registered folder for a main checkout, reusing one registered under an alias of it,
       * otherwise the checkout added under Git's spelling. */
      const folderOf = Effect.fn("SessionHosts.folderOf")(function* (main: string) {
        return (yield* registeredFolder(main)) ?? (yield* registry.addFolder(main));
      });

      const place = Effect.fn("SessionHosts.place")(function* (raw: string) {
        const path = directoryPath(raw);
        yield* Directories.require(path).pipe(
          Effect.mapError((e) => new RegistryError({ detail: e.detail })),
        );
        const physical = (yield* physicalPath(path)) ?? path;
        const data = yield* registry.get;
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

      /**
       * A new worktree for a new session, created through Worktrunk (INV-06) from the folder of
       * `raw`'s repository: from anywhere in a linked worktree its main checkout, otherwise the
       * checkout's root. The folder and the worktree are registered as `place` would; a failure
       * starts nothing and never falls back to `raw` itself.
       */
      const placeWorktree = Effect.fn("SessionHosts.placeWorktree")(function* (
        raw: string,
        worktree: WorktreeRequest,
      ) {
        const path = directoryPath(raw);
        yield* Directories.require(path).pipe(
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
        const created = yield* worktrees.create(folder, worktree.branch, { hooks: worktree.hooks });
        return created.path;
      });

      /** Where a new session goes, registering only its folder or worktree: no session yet. */
      const destination = Effect.fn("SessionHosts.destination")(
        function* (spec: CreateSpec) {
          // Registry writes run before the ownership lock; an unavailable project registers nothing.
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

      const create = Effect.fn("SessionHosts.create")(
        function* (spec: CreateSpec) {
          const cwd = yield* destination(spec);
          const { model, thinkingLevel, name, dispatchedFrom } = spec.options;
          // Only a fresh server-generated ID may create a reference. Registration and initial
          // membership survive a disconnected requester, as acquisition is server-owned.
          const { session } = yield* start(
            { cwd, sessionId: randomUUID(), model, thinkingLevel, name, dispatchedFrom },
            notCreated,
            { projectId: spec.projectId },
          );
          return session;
        },
        // Creation is server-owned from its first step: a requester that leaves while Worktrunk
        // runs cannot interrupt it into a half-made checkout; the worktree, the registration and
        // the launch complete, and the session is found by the ID the registry holds.
        owned,
      );

      const get = (cwd: string, id: string) =>
        resolved(cwd, id, ({ host }) => Effect.succeed(host?.session));

      const read = Effect.fn("SessionHosts.read")(function* (
        cwd: string,
        id: string,
      ): Effect.fn.Return<SessionReadback, PiSessionError> {
        return yield* resolved(cwd, id, ({ key, ref, host }) =>
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
        );
      });

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
              ? yield* close(key, host, { requested: true }).pipe(
                  Effect.andThen(references.resolve(ref.cwd, id)),
                )
              : ref;
            yield* remove ? references.remove(final) : references.archive(final);
          }),
        );

      if (options.idleMs > 0)
        yield* Effect.gen(function* () {
          for (const [key, host] of hosts) {
            const lock = yield* lockFor(key);
            // One host's failed check or release stays with it; the rest of the sweep still runs.
            yield* Semaphore.withPermits(
              lock,
              1,
            )(
              Effect.gen(function* () {
                if (hosts.get(key) === host && (yield* host.idle(options.idleMs)))
                  yield* close(key, host);
              }),
            ).pipe(Effect.catchTag("PiSessionError", (error) => Effect.logWarning(error.detail)));
          }
        }).pipe(Effect.delay(Math.min(15_000, options.idleMs)), Effect.forever, Effect.forkScoped);

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          stopping = true;
          for (const [key, host] of hosts)
            yield* close(key, host, { shutdown: true }).pipe(
              Effect.catchTag("PiSessionError", (error) => Effect.logWarning(error.detail)),
            );
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
        // Subscribed before the list is read: a change in between arrives after it, not never.
        subscribe: Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changed);
          return Stream.concat(Stream.make(yield* list), Stream.fromSubscription(subscription));
        }),
        lifecycleChanges: Stream.fromPubSub(lifecycle),
      });
    }),
  ).pipe(
    Layer.provideMerge(SessionReferencesLive),
    Layer.provideMerge(WebhooksLive),
    Layer.provideMerge(FolderWorktreesLive),
  );
