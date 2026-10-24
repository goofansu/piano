/**
 * What piano knows about: folders, projects, the worktrees created through piano, and
 * the sessions started through piano. SQLite owns persistence. Pi's own session store is only consulted to
 * load a session's history; it is never scanned to populate the sidebar.
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Context, Data, Effect, Layer, Ref, Schema, type Scope, Semaphore } from "effect";
import { RadiusShareLink } from "../shared/share.ts";
import type { WebhookEvent } from "../shared/webhooks.ts";
import {
  Project,
  SESSION_TITLE_MAX,
  SessionPullRequestLink,
  SessionStats,
  sameSession,
  sessionKey,
  Workspace,
} from "../shared/wire.ts";
import { Directories } from "./Directories.ts";
import { directoryPath } from "./PiEnv.ts";
import { openRegistryDatabase } from "./RegistryDatabase.ts";

export class RegistryError extends Data.TaggedError("RegistryError")<{ readonly detail: string }> {
  override get message() {
    return this.detail;
  }
}

/** A typed lookup miss. `detail` is the text shown to the person. */
export class RegistryLookupError extends Data.TaggedError("RegistryLookupError")<{
  readonly subject: "workspace" | "session" | "folder" | "project";
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}

const WorktreeEntry = Schema.Struct({
  folder: Schema.String,
  path: Schema.String,
  branch: Schema.String,
});
export type WorktreeEntry = typeof WorktreeEntry.Type;

/** A session reference's integration links: identities owned by Piano, facts owned by the forge or Radius. */
const sessionLinkFields = {
  /** Absent: discover from the checkout. Null: explicitly removed. No forge status is persisted. */
  pullRequest: Schema.optional(Schema.NullOr(SessionPullRequestLink)),
  /** Stable Radius destination. Its revisions and contents remain owned by Radius. */
  radiusShare: Schema.optional(RadiusShareLink),
};
const SessionLinks = Schema.Struct(sessionLinkFields);
export type SessionLinks = typeof SessionLinks.Type;
export type SessionLinkKey = keyof SessionLinks;

/** One session reference: the registry's single statement of a session's fields. */
const SessionEntry = Schema.Struct({
  ...sessionLinkFields,
  projectId: Schema.optional(Schema.String),
  cwd: Schema.String,
  sessionId: Schema.String,
  title: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archived: Schema.Boolean,
  /** Sidebar preference; absent means unpinned. */
  pinned: Schema.optional(Schema.Boolean),
  /** Replaceable last-known Pi accounting, not session history. */
  stats: Schema.optional(SessionStats),
});
export type SessionEntry = typeof SessionEntry.Type;

/** What a session reference shows: cached statistics and the Radius share never reach the sidebar.
 * The pull request link does, so a browser reads GitHub facts only for a session that has one. */
export const shownReference = ({
  stats: _stats,
  radiusShare: _radiusShare,
  ...shown
}: SessionEntry): Omit<SessionEntry, "stats" | "radiusShare"> => shown;

/**
 * `entry` is still the reference `expected` was read as: not recreated (same creation time), not
 * archived since, and, when `link` is named, that link unchanged.
 */
const sameReference = (entry: SessionEntry, expected: SessionEntry, link?: SessionLinkKey) =>
  entry.createdAt === expected.createdAt &&
  (!entry.archived || expected.archived) &&
  (link === undefined || entry[link] === expected[link]);

/** Private integration credentials, deliberately outside RegistryData and its listeners. */
export interface StoredWebhook {
  readonly id: string;
  readonly url: string;
  readonly token: string | null;
  readonly events: readonly WebhookEvent[];
  readonly active: boolean;
  readonly createdAt: string;
}

export interface RegistryData {
  readonly version: 2;
  readonly projects: ReadonlyArray<Project>;
  readonly workspaces: ReadonlyArray<Workspace>;
  readonly folders: ReadonlyArray<string>;
  readonly worktrees: ReadonlyArray<WorktreeEntry>;
  readonly sessions: ReadonlyArray<SessionEntry>;
}

export const DEFAULT_DB_PATH = resolve(
  join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "piano", "piano.db"),
);
/** `PIANO_DB_PATH` selects a scratch database; tests inject one directly. */
export const RegistryDatabasePath = Context.Reference<string>("piano/RegistryDatabasePath", {
  defaultValue: () => resolve(process.env.PIANO_DB_PATH ?? DEFAULT_DB_PATH),
});

const currentSchema = Schema.Struct({
  version: Schema.Literal(2),
  folders: Schema.Array(Schema.String),
  worktrees: Schema.Array(WorktreeEntry),
  workspaces: Schema.Array(Workspace),
  projects: Schema.Array(Project),
  sessions: Schema.Array(SessionEntry),
});

/** Path references keep their spelling: never move or merge Pi's alias-based history. */
function withWorkspaces(
  data: RegistryData,
  candidates: ReadonlyArray<string> = [
    ...data.folders,
    ...data.worktrees.map((w) => w.path),
    ...data.sessions.map((s) => s.cwd),
  ],
): RegistryData {
  const paths = new Set(data.workspaces.map((w) => w.path));
  const parents = new Map(data.worktrees.map((w) => [w.path, w.folder]));
  const added: Workspace[] = [];
  for (const path of candidates) {
    if (!paths.has(path)) {
      paths.add(path);
      added.push({ id: randomUUID(), path, folder: parents.get(path) ?? path });
    }
  }
  return added.length ? { ...data, workspaces: [...data.workspaces, ...added] } : data;
}
/**
 * Every write keeps "each folder, worktree and session cwd has a workspace", which `decode`
 * requires on the next start. Only rows that are new or replaced at their index are checked, and
 * a replaced row that keeps its path adds nothing, so a session metadata update compares
 * references without building the workspace path set.
 */
function withAddedWorkspaces(before: RegistryData, after: RegistryData): RegistryData {
  const candidates: string[] = [];
  const scan = <A>(was: ReadonlyArray<A>, is: ReadonlyArray<A>, path: (row: A) => string) => {
    if (was === is) return;
    is.forEach((row, i) => {
      const old = was[i];
      if (row !== old && (old === undefined || path(row) !== path(old))) candidates.push(path(row));
    });
  };
  scan(before.folders, after.folders, (p) => p);
  scan(before.worktrees, after.worktrees, (w) => w.path);
  scan(before.sessions, after.sessions, (s) => s.cwd);
  return candidates.length ? withWorkspaces(after, candidates) : after;
}

/** Mutations are immutable. Compare only replaced items, retaining value-equal references too. */
function shareCollection<A>(before: ReadonlyArray<A>, after: ReadonlyArray<A>): ReadonlyArray<A> {
  if (before === after) return before;
  let unchanged = before.length === after.length;
  const shared = after.map((item, i) => {
    if (item === before[i] || JSON.stringify(item) === JSON.stringify(before[i])) return before[i];
    unchanged = false;
    return item;
  });
  return unchanged ? before : shared;
}
function shareUnchanged(before: RegistryData, after: RegistryData): RegistryData {
  const data: RegistryData = {
    version: after.version,
    projects: shareCollection(before.projects, after.projects),
    workspaces: shareCollection(before.workspaces, after.workspaces),
    folders: shareCollection(before.folders, after.folders),
    worktrees: shareCollection(before.worktrees, after.worktrees),
    sessions: shareCollection(before.sessions, after.sessions),
  };
  return Object.keys(data).every(
    (key) => data[key as keyof RegistryData] === before[key as keyof RegistryData],
  )
    ? before
    : data;
}
function decode(value: unknown): RegistryData {
  const initial: RegistryData = Schema.decodeUnknownSync(currentSchema)(value);
  if (new Set(initial.folders).size !== initial.folders.length)
    throw new Error("Duplicate selected folders.");
  if (new Set(initial.worktrees.map((w) => w.path)).size !== initial.worktrees.length)
    throw new Error("Duplicate worktree references.");
  const ids = new Set(initial.projects.map((p) => p.id));
  if (ids.size !== initial.projects.length || initial.projects.some((p) => !p.name.trim()))
    throw new Error("Duplicate project identities or blank project name.");
  if (
    new Set(initial.sessions.map((s) => sessionKey(s.cwd, s.sessionId))).size !==
    initial.sessions.length
  )
    throw new Error("Duplicate session references.");
  if (initial.sessions.some((s) => s.projectId !== undefined && !ids.has(s.projectId)))
    throw new Error("Session references an unknown project.");
  for (const p of [
    ...initial.folders,
    ...initial.worktrees.flatMap((w) => [w.path, w.folder]),
    ...initial.sessions.map((s) => s.cwd),
    ...initial.workspaces.flatMap((w) => [w.path, w.folder]),
  ]) {
    if (!isAbsolute(p)) throw new Error(`Registry path is not absolute: ${p}`);
  }
  if (
    new Set(initial.workspaces.map((w) => w.id)).size !== initial.workspaces.length ||
    new Set(initial.workspaces.map((w) => w.path)).size !== initial.workspaces.length ||
    initial.workspaces.some((w) => !w.id)
  )
    throw new Error("Duplicate or empty workspace identities.");
  if (withWorkspaces(initial).workspaces.length !== initial.workspaces.length)
    throw new Error("Missing workspace identities in registry.");
  return initial;
}
const recovery = (path: string, error: unknown) =>
  new RegistryError({
    detail: `Cannot read or persist registry ${path}. It has not been reset. Restore a known-good backup or repair the database before restarting. ${String(error)}`,
  });
/** A folder must name an existing directory before it is registered. */
const requireDirectory = (raw: string) =>
  Directories.require(raw).pipe(
    Effect.mapError((error) => new RegistryError({ detail: error.detail })),
  );

/** Told about each write that changed the data, with the data before and after it. */
export type RegistryListener = (before: RegistryData, after: RegistryData) => Effect.Effect<void>;

export class Registry extends Context.Service<
  Registry,
  {
    readonly get: Effect.Effect<RegistryData>;
    readonly webhooks: Effect.Effect<readonly StoredWebhook[], RegistryError>;
    readonly saveWebhook: (hook: StoredWebhook) => Effect.Effect<void, RegistryError>;
    readonly removeWebhook: (id: string) => Effect.Effect<void, RegistryError>;
    /**
     * Hear about every write that changes the data, for the listener's scope. The writer
     * waits for its listeners, so whatever they publish is out before the write returns;
     * a write that changes nothing is not announced.
     */
    readonly onChange: (listener: RegistryListener) => Effect.Effect<void, never, Scope.Scope>;
    /** The registered workspace with this ID. */
    readonly workspace: (id: string) => Effect.Effect<Workspace, RegistryLookupError>;
    /** A session reference registered at this workspace's exact path. */
    readonly sessionIn: (
      workspaceId: string,
      sessionId: string,
    ) => Effect.Effect<
      { readonly workspace: Workspace; readonly session: SessionEntry },
      RegistryLookupError
    >;
    /** Succeeds only for a folder the person added (exact path spelling). */
    readonly requireFolder: (path: string) => Effect.Effect<void, RegistryLookupError>;
    /** A known project. */
    readonly requireProject: (id: string) => Effect.Effect<Project, RegistryLookupError>;
    /**
     * Create a project, its name and any instructions trimmed. An existing ID is refused and
     * left as it is: `updateProject` is the one way to change a project. With `assign`, that
     * session joins it in the same write: one change announcement, and an unregistered session
     * rejects the whole save.
     */
    readonly saveProject: (
      project: Pick<Project, "id" | "name" | "instructions">,
      assign?: { readonly cwd: string; readonly sessionId: string },
    ) => Effect.Effect<void, RegistryError>;
    /**
     * Change a known project's name or instructions in one write, both trimmed. A blank name is
     * refused; null or blank instructions clear them. An unknown project is refused, so a change
     * racing its deletion cannot bring it back.
     */
    readonly updateProject: (
      id: string,
      change: { readonly name?: string; readonly instructions?: string | null },
    ) => Effect.Effect<void, RegistryError>;
    /** Remove a project in one write; its sessions stay registered and move to No project. */
    readonly deleteProject: (id: string) => Effect.Effect<void, RegistryError>;
    readonly assignProject: (
      cwd: string,
      sessionId: string,
      projectId: string | null,
    ) => Effect.Effect<void, RegistryError>;
    /** Open an existing directory as a folder under this exact spelling, returned; an open folder stays as it is. Which directory a session belongs to is SessionHosts' decision. */
    readonly addFolder: (path: string) => Effect.Effect<string, RegistryError>;
    readonly removeFolder: (path: string) => Effect.Effect<void, RegistryError>;
    /** Register a worktree. An already registered path keeps its entry. */
    readonly addWorktree: (entry: WorktreeEntry) => Effect.Effect<void, RegistryError>;
    /**
     * Save the branch Git last reported for registered worktrees, as their last-known value
     * (INV-01): shown once Git no longer lists them. One write and one announcement for the batch;
     * an unregistered path, a blank branch or an unchanged one is left alone.
     */
    readonly observeWorktreeBranches: (
      observed: ReadonlyArray<{ readonly path: string; readonly branch: string }>,
    ) => Effect.Effect<void, RegistryError>;
    /** Register a session and its initial, currently active project in one write. Existing references stay unchanged. */
    readonly addSession: (
      cwd: string,
      sessionId: string,
      title?: string,
      projectId?: string,
    ) => Effect.Effect<void, RegistryError>;
    /** Bump a session's activity time; sets the title from the first prompt when neither a start name nor Pi's name gave one. */
    readonly touchSession: (
      cwd: string,
      sessionId: string,
      text?: string,
    ) => Effect.Effect<void, RegistryError>;
    /**
     * Mirror Pi's facts onto a session reference in one write: Pi's session name, when it has
     * one, replaces the title; statistics replace the last-known cache. Never changes activity
     * or order, and never creates a reference.
     */
    readonly mirrorSession: (
      cwd: string,
      sessionId: string,
      facts: { readonly sessionName?: string; readonly stats?: SessionStats },
    ) => Effect.Effect<void, RegistryError>;
    /**
     * The registered entry for `expected` while it is still that reference: not removed,
     * recreated or archived since it was read, and, when `link` is named, with that link
     * unchanged. Undefined otherwise.
     */
    readonly current: (
      expected: SessionEntry,
      link?: SessionLinkKey,
    ) => Effect.Effect<SessionEntry | undefined>;
    /**
     * Compare-and-set one integration link, applied only while `expected` is `current` with
     * that link unchanged, so a delayed forge or Radius result cannot undo a removal, overwrite
     * a newer choice or resurrect a deleted reference. Returns the saved entry, or undefined
     * when refused.
     */
    readonly setSessionLink: <K extends SessionLinkKey>(
      expected: SessionEntry,
      link: K,
      value: SessionLinks[K],
    ) => Effect.Effect<SessionEntry | undefined, RegistryError>;
    readonly pinSession: (
      cwd: string,
      sessionId: string,
      pinned: boolean,
    ) => Effect.Effect<void, RegistryError>;
    readonly archiveSession: (cwd: string, sessionId: string) => Effect.Effect<void, RegistryError>;
    readonly removeSession: (cwd: string, sessionId: string) => Effect.Effect<void, RegistryError>;
  }
>()("piano/Registry") {}

export const RegistryLive = Layer.effect(
  Registry,
  Effect.gen(function* () {
    const path = resolve(yield* RegistryDatabasePath);
    const database = yield* Effect.acquireRelease(
      Effect.try({ try: () => openRegistryDatabase(path), catch: (e) => recovery(path, e) }),
      (db) => Effect.sync(() => db.close()),
    );
    const state = yield* Ref.make(
      yield* Effect.try({ try: () => decode(database.data), catch: (e) => recovery(path, e) }),
    );
    const lock = yield* Semaphore.make(1);
    const listeners = new Set<RegistryListener>();
    const update = Effect.fn("Registry.update")(function* (f: (d: RegistryData) => RegistryData) {
      const change = yield* Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          const next = yield* Effect.try({
            try: () => f(current),
            catch: (e) => (e instanceof RegistryError ? e : recovery(path, e)),
          });
          if (next === current) return undefined;
          const data = shareUnchanged(current, withAddedWorkspaces(current, next));
          if (data === current) return undefined;
          yield* Effect.try({
            try: () => database.save(current, data),
            catch: (e) => recovery(path, e),
          });
          yield* Ref.set(state, data);
          return { before: current, after: data };
        }),
      );
      if (!change) return;
      // Outside the lock, so a listener may read the registry; it reads at least this write.
      // The write is saved either way: a failing listener is logged, never reported as a failed write.
      yield* Effect.forEach(
        [...listeners],
        (listener) =>
          listener(change.before, change.after).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("registry change listener failed", cause),
            ),
          ),
        { discard: true },
      );
    }, Effect.uninterruptible);
    const now = () => new Date().toISOString();
    /** The one place a session's title is decided: trimmed, at most SESSION_TITLE_MAX, empty is none. */
    const titleOf = (text: string | undefined) =>
      text?.trim().slice(0, SESSION_TITLE_MAX).trim() || undefined;
    const isSession = (cwd: string, sessionId: string) => (t: SessionEntry) =>
      sameSession(t, { cwd, sessionId });
    const currentIn = (d: RegistryData, expected: SessionEntry, link?: SessionLinkKey) => {
      const entry = d.sessions.find(isSession(expected.cwd, expected.sessionId));
      return entry && sameReference(entry, expected, link) ? entry : undefined;
    };

    const workspace = (id: string) =>
      Effect.flatMap(Ref.get(state), (d) => {
        const found = d.workspaces.find((w) => w.id === id);
        return found
          ? Effect.succeed(found)
          : Effect.fail(
              new RegistryLookupError({
                subject: "workspace",
                detail: "Workspace is not registered. Refresh the folder list.",
              }),
            );
      });

    return Registry.of({
      get: Ref.get(state),
      webhooks: Effect.try({
        try: database.webhooks,
        catch: () => new RegistryError({ detail: "Could not read webhooks." }),
      }),
      saveWebhook: Effect.fn("Registry.saveWebhook")(function* (hook) {
        yield* Effect.try({
          try: () => database.saveWebhook(hook),
          catch: () => new RegistryError({ detail: "Could not save webhook." }),
        });
      }),
      removeWebhook: Effect.fn("Registry.removeWebhook")(function* (id) {
        yield* Effect.try({
          try: () => database.removeWebhook(id),
          catch: () => new RegistryError({ detail: "Could not delete webhook." }),
        });
      }),
      onChange: (listener) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            listeners.add(listener);
          }),
          () =>
            Effect.sync(() => {
              listeners.delete(listener);
            }),
        ),
      workspace,
      sessionIn: (workspaceId, sessionId) =>
        Effect.flatMap(Ref.get(state), (d) => {
          const found = d.workspaces.find((w) => w.id === workspaceId);
          const session = found && d.sessions.find(isSession(found.path, sessionId));
          return found && session
            ? Effect.succeed({ workspace: found, session })
            : Effect.fail(
                new RegistryLookupError({
                  subject: "session",
                  detail: "Session is not registered in this workspace. Refresh the session list.",
                }),
              );
        }),
      requireFolder: (path) =>
        Effect.flatMap(Ref.get(state), (d) =>
          d.folders.includes(path)
            ? Effect.void
            : Effect.fail(
                new RegistryLookupError({
                  subject: "folder",
                  detail: "Select a registered folder first.",
                }),
              ),
        ),
      requireProject: (id) =>
        Effect.flatMap(Ref.get(state), (d) => {
          const project = d.projects.find((p) => p.id === id);
          return project
            ? Effect.succeed(project)
            : Effect.fail(
                new RegistryLookupError({
                  subject: "project",
                  detail: "Project is unavailable. Choose a current project before starting.",
                }),
              );
        }),
      saveProject: (project, assign) =>
        update((d) => {
          const parsed = Schema.decodeUnknownSync(Project)(project);
          if (!parsed.name.trim()) throw new RegistryError({ detail: "A project needs a name." });
          if (assign && !d.sessions.some(isSession(assign.cwd, assign.sessionId)))
            throw new RegistryError({
              detail: "Session reference is unavailable. Refresh and try again.",
            });
          if (d.projects.some((p) => p.id === parsed.id))
            throw new RegistryError({ detail: "Project already exists. Refresh and try again." });
          const instructions = parsed.instructions?.trim();
          const next = {
            id: parsed.id,
            name: parsed.name.trim(),
            ...(instructions ? { instructions } : {}),
          };
          const projects = [...d.projects, next];
          const sessions = assign
            ? d.sessions.map((s) =>
                isSession(assign.cwd, assign.sessionId)(s) ? { ...s, projectId: next.id } : s,
              )
            : d.sessions;
          return { ...d, projects, sessions };
        }),
      updateProject: (id, change) =>
        update((d) => {
          if (!d.projects.some((p) => p.id === id))
            throw new RegistryError({ detail: "Project is unavailable. Refresh and try again." });
          const name = change.name?.trim();
          if (name === "") throw new RegistryError({ detail: "A project needs a name." });
          const text = change.instructions?.trim();
          return {
            ...d,
            projects: d.projects.map((p) => {
              if (p.id !== id) return p;
              const named = name ? { ...p, name } : p;
              if (change.instructions === undefined) return named;
              const { instructions: _, ...rest } = named;
              return text ? { ...rest, instructions: text } : rest;
            }),
          };
        }),
      deleteProject: (id) =>
        update((d) => {
          if (!d.projects.some((p) => p.id === id))
            throw new RegistryError({ detail: "Project is unavailable. Refresh and try again." });
          return {
            ...d,
            projects: d.projects.filter((p) => p.id !== id),
            sessions: d.sessions.map((s) =>
              s.projectId === id ? { ...s, projectId: undefined } : s,
            ),
          };
        }),
      assignProject: (cwd, sessionId, projectId) =>
        update((d) => {
          if (!d.sessions.some(isSession(cwd, sessionId)))
            throw new RegistryError({
              detail: "Session reference is unavailable. Refresh and try again.",
            });
          if (projectId !== null && !d.projects.some((p) => p.id === projectId))
            throw new RegistryError({ detail: "Project is unavailable. Refresh and try again." });
          return {
            ...d,
            sessions: d.sessions.map((s) =>
              isSession(cwd, sessionId)(s) ? { ...s, projectId: projectId ?? undefined } : s,
            ),
          };
        }),
      addFolder: (raw) =>
        Effect.gen(function* () {
          const path = directoryPath(raw);
          yield* requireDirectory(path);
          yield* update((x) =>
            x.folders.includes(path) ? x : { ...x, folders: [...x.folders, path] },
          );
          return path;
        }),
      // Closing a folder only hides it; its worktrees and sessions stay registered so
      // starting a session in that directory again brings everything back.
      removeFolder: (path) =>
        update((d) => ({ ...d, folders: d.folders.filter((p) => p !== path) })),
      addWorktree: (entry) =>
        update((d) =>
          d.worktrees.some((w) => w.path === entry.path)
            ? d
            : { ...d, worktrees: [...d.worktrees, entry] },
        ),
      observeWorktreeBranches: Effect.fn("Registry.observeWorktreeBranches")(function* (observed) {
        const branches = new Map(
          observed.filter((o) => o.branch.trim()).map((o) => [o.path, o.branch] as const),
        );
        if (!branches.size) return;
        yield* update((d) => {
          let changed = false;
          const worktrees = d.worktrees.map((w) => {
            const branch = branches.get(w.path);
            if (branch === undefined || branch === w.branch) return w;
            changed = true;
            return { ...w, branch };
          });
          return changed ? { ...d, worktrees } : d;
        });
      }),
      addSession: (cwd, sessionId, title, projectId) =>
        update((d) => {
          if (d.sessions.some(isSession(cwd, sessionId))) return d;
          if (projectId !== undefined && !d.projects.some((p) => p.id === projectId))
            throw new RegistryError({
              detail: "Project is unavailable. Choose a current project before starting.",
            });
          const t = now();
          return {
            ...d,
            sessions: [
              ...d.sessions,
              {
                cwd,
                sessionId,
                title: titleOf(title),
                projectId,
                createdAt: t,
                updatedAt: t,
                archived: false,
              },
            ],
          };
        }),
      touchSession: (cwd, sessionId, text) =>
        update((d) => ({
          ...d,
          sessions: d.sessions.map((t) =>
            isSession(cwd, sessionId)(t)
              ? {
                  ...t,
                  updatedAt: now(),
                  title: t.title ?? titleOf(text),
                }
              : t,
          ),
        })),
      mirrorSession: (cwd, sessionId, facts) =>
        update((d) => {
          const entry = d.sessions.find(isSession(cwd, sessionId));
          if (!entry) return d;
          // Pi owns the name; a session Pi has not named keeps its start name or first prompt.
          const title = titleOf(facts.sessionName) || entry.title;
          const stats = facts.stats ?? entry.stats;
          if (title === entry.title && JSON.stringify(stats) === JSON.stringify(entry.stats))
            return d;
          return {
            ...d,
            sessions: d.sessions.map((t) => (t === entry ? { ...t, title, stats } : t)),
          };
        }),
      current: (expected, link) => Effect.map(Ref.get(state), (d) => currentIn(d, expected, link)),
      setSessionLink: Effect.fn("Registry.setSessionLink")(function* <K extends SessionLinkKey>(
        expected: SessionEntry,
        link: K,
        value: SessionLinks[K],
      ) {
        let saved: SessionEntry | undefined;
        yield* update((d) => {
          const entry = currentIn(d, expected, link);
          if (!entry) return d;
          const next: SessionEntry = { ...entry, [link]: value };
          saved = next;
          return { ...d, sessions: d.sessions.map((s) => (s === entry ? next : s)) };
        });
        return saved;
      }),
      pinSession: Effect.fn("Registry.pinSession")(function* (cwd, sessionId, pinned) {
        yield* update((d) => {
          const entry = d.sessions.find(isSession(cwd, sessionId));
          if (!entry || entry.archived)
            throw new RegistryError({
              detail: "Session reference is unavailable. Refresh and try again.",
            });
          if (!!entry.pinned === pinned) return d;
          return {
            ...d,
            sessions: d.sessions.map((s) =>
              s === entry ? { ...s, pinned: pinned || undefined } : s,
            ),
          };
        });
      }),
      archiveSession: (cwd, sessionId) =>
        update((d) => ({
          ...d,
          sessions: d.sessions.map((t) =>
            isSession(cwd, sessionId)(t) ? { ...t, archived: true } : t,
          ),
        })),
      removeSession: (cwd, sessionId) =>
        update((d) => ({
          ...d,
          sessions: d.sessions.filter((t) => !isSession(cwd, sessionId)(t)),
        })),
    });
  }),
);
