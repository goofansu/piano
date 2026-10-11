/**
 * What piano knows about: folders, projects, the worktrees created through piano, and
 * the sessions started through piano. SQLite owns persistence. Pi's own session store is only consulted to
 * load a session's history; it is never scanned to populate the sidebar.
 */

import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Context, Data, Effect, Layer, Ref, Schema, type Scope, Semaphore } from "effect";
import { Project, SessionPullRequestLink, SessionStats, Workspace } from "../shared/wire.ts";
import { directoryPath } from "./PiEnv.ts";
import { openRegistryDatabase } from "./RegistryDatabase.ts";

export class RegistryError extends Data.TaggedError("RegistryError")<{ readonly detail: string }> {
  override get message() { return this.detail; }
}

/** A typed lookup miss. `detail` is the text shown to the person. */
export class RegistryLookupError extends Data.TaggedError("RegistryLookupError")<{
  readonly subject: "workspace" | "session" | "folder" | "project";
  readonly detail: string;
}> {
  override get message() { return this.detail; }
}

export interface WorktreeEntry {
  readonly folder: string;
  readonly path: string;
  readonly branch: string;
}

export interface SessionEntry {
  readonly projectId?: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly title?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archived: boolean;
  /** Replaceable last-known Pi accounting, not session history. */
  readonly stats?: SessionStats;
  /** Absent: discover from the checkout. Null: explicitly removed. No forge status is persisted. */
  readonly pullRequest?: SessionPullRequestLink | null;
}

export interface RegistryData {
  readonly version: 2;
  readonly projects: ReadonlyArray<Project>;
  readonly workspaces: ReadonlyArray<Workspace>;
  readonly folders: ReadonlyArray<string>;
  readonly worktrees: ReadonlyArray<WorktreeEntry>;
  readonly sessions: ReadonlyArray<SessionEntry>;
}

export const DEFAULT_DB_PATH = resolve(join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "piano", "piano.db"));
/** `PIANO_DB_PATH` selects a scratch database; tests inject one directly. */
export const RegistryDatabasePath = Context.Reference<string>("piano/RegistryDatabasePath", { defaultValue: () => resolve(process.env.PIANO_DB_PATH ?? DEFAULT_DB_PATH) });

const currentSchema = Schema.Struct({
  version: Schema.Literal(2),
  folders: Schema.Array(Schema.String),
  worktrees: Schema.Array(Schema.Struct({ folder: Schema.String, path: Schema.String, branch: Schema.String })),
  workspaces: Schema.Array(Workspace),
  projects: Schema.Array(Project),
  sessions: Schema.Array(Schema.Struct({ cwd: Schema.String, sessionId: Schema.String, title: Schema.optional(Schema.String),
    createdAt: Schema.String, updatedAt: Schema.String, archived: Schema.Boolean, stats: Schema.optional(SessionStats),
    pullRequest: Schema.optional(Schema.NullOr(SessionPullRequestLink)), projectId: Schema.optional(Schema.String) })),
});

/** Path references keep their spelling: never move or merge Pi's alias-based history. */
function withWorkspaces(data: RegistryData): RegistryData {
  const workspaces = [...data.workspaces];
  for (const path of [...data.folders, ...data.worktrees.map(w => w.path), ...data.sessions.map(s => s.cwd)]) {
    if (!workspaces.some(w => w.path === path)) workspaces.push({ id: randomUUID(), path, folder: data.worktrees.find(w => w.path === path)?.folder ?? path });
  }
  return { ...data, workspaces };
}
function decode(value: unknown): RegistryData {
  const initial: RegistryData = Schema.decodeUnknownSync(currentSchema)(value);
  if (new Set(initial.folders).size !== initial.folders.length) throw new Error("Duplicate selected folders.");
  if (new Set(initial.worktrees.map(w => w.path)).size !== initial.worktrees.length) throw new Error("Duplicate worktree references.");
  const ids = new Set(initial.projects.map(p => p.id));
  if (ids.size !== initial.projects.length || initial.projects.some(p => !p.name.trim())) throw new Error("Duplicate project identities or blank project name.");
  if (new Set(initial.sessions.map(s => JSON.stringify([s.cwd, s.sessionId]))).size !== initial.sessions.length) throw new Error("Duplicate session references.");
  if (initial.sessions.some(s => s.projectId !== undefined && !ids.has(s.projectId))) throw new Error("Session references an unknown project.");
  for (const p of [...initial.folders, ...initial.worktrees.flatMap(w => [w.path, w.folder]), ...initial.sessions.map(s => s.cwd), ...initial.workspaces.flatMap(w => [w.path, w.folder])]) {
    if (!isAbsolute(p)) throw new Error(`Registry path is not absolute: ${p}`);
  }
  if (new Set(initial.workspaces.map(w => w.id)).size !== initial.workspaces.length || new Set(initial.workspaces.map(w => w.path)).size !== initial.workspaces.length || initial.workspaces.some(w => !w.id)) throw new Error("Duplicate or empty workspace identities.");
  if (withWorkspaces(initial).workspaces.length !== initial.workspaces.length) throw new Error("Missing workspace identities in registry.");
  return initial;
}
const recovery = (path: string, error: unknown) => new RegistryError({ detail: `Cannot read or persist registry ${path}. It has not been reset. Restore a known-good backup or repair the database before restarting. ${String(error)}` });

/** Told about each write that changed the data, with the data before and after it. */
export type RegistryListener = (before: RegistryData, after: RegistryData) => Effect.Effect<void>;

export class Registry extends Context.Service<
  Registry,
  {
    readonly get: Effect.Effect<RegistryData>;
    /**
     * Hear about every write that changes the data, for the listener's scope. The writer
     * waits for its listeners, so whatever they publish is out before the write returns;
     * a write that changes nothing is not announced.
     */
    readonly onChange: (listener: RegistryListener) => Effect.Effect<void, never, Scope.Scope>;
    /** The registered workspace with this ID. */
    readonly workspace: (id: string) => Effect.Effect<Workspace, RegistryLookupError>;
    /** A session reference registered at this workspace's exact path. */
    readonly sessionIn: (workspaceId: string, sessionId: string) => Effect.Effect<{ readonly workspace: Workspace; readonly session: SessionEntry }, RegistryLookupError>;
    /** Succeeds only for a folder the person added (exact path spelling). */
    readonly requireFolder: (path: string) => Effect.Effect<void, RegistryLookupError>;
    /** A known project that is not archived. */
    readonly requireActiveProject: (id: string) => Effect.Effect<Project, RegistryLookupError>;
    readonly saveProject: (project: Omit<Project, "archived">) => Effect.Effect<void, RegistryError>;
    readonly archiveProject: (id: string, archived: boolean) => Effect.Effect<void, RegistryError>;
    readonly assignProject: (cwd: string, sessionId: string, projectId: string | null) => Effect.Effect<void, RegistryError>;
    readonly addFolder: (path: string) => Effect.Effect<void, RegistryError>;
    /** Make sure a directory is usable as a session cwd: a folder root or a registered worktree. Adds it as a folder otherwise. */
    readonly ensureFolder: (path: string) => Effect.Effect<string, RegistryError>;
    readonly removeFolder: (path: string) => Effect.Effect<void, RegistryError>;
    readonly addWorktree: (entry: WorktreeEntry) => Effect.Effect<void, RegistryError>;
    /** Register a session started through piano. Idempotent. */
    readonly addSession: (cwd: string, sessionId: string, title?: string) => Effect.Effect<void, RegistryError>;
    /** Bump a session's activity time; sets the title from the first prompt when neither a start name nor Pi's name gave one. */
    readonly touchSession: (cwd: string, sessionId: string, text?: string) => Effect.Effect<void, RegistryError>;
    /**
     * Mirror Pi's facts onto a session reference in one write: Pi's session name, when it has
     * one, replaces the title; statistics replace the last-known cache. Never changes activity
     * or order, and never creates a reference.
     */
    readonly mirrorSession: (cwd: string, sessionId: string, facts: { readonly sessionName?: string; readonly stats?: SessionStats }) => Effect.Effect<void, RegistryError>;
    /** Compare-and-set the association: delayed forge reads cannot undo removal or overwrite a newer choice. */
    readonly setSessionPullRequest: (expected: SessionEntry, link: SessionPullRequestLink | null | undefined) => Effect.Effect<boolean, RegistryError>;
    readonly archiveSession: (cwd: string, sessionId: string) => Effect.Effect<void, RegistryError>;
    readonly removeSession: (cwd: string, sessionId: string) => Effect.Effect<void, RegistryError>;
  }
>()("piano/Registry") {}

export const RegistryLive = Layer.effect(
  Registry,
  Effect.gen(function* () {
    const path = resolve(yield* RegistryDatabasePath);
    const database = yield* Effect.acquireRelease(
      Effect.try({ try: () => openRegistryDatabase(path), catch: e => recovery(path, e) }),
      db => Effect.sync(() => db.close()),
    );
    const state = yield* Ref.make(yield* Effect.try({ try: () => decode(database.data), catch: e => recovery(path, e) }));
    const lock = yield* Semaphore.make(1);
    const listeners = new Set<RegistryListener>();
    const update = (f: (d: RegistryData) => RegistryData) => Effect.gen(function* () {
      const change = yield* Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const next = yield* Effect.try({ try: () => f(current), catch: e => e instanceof RegistryError ? e : recovery(path, e) });
        if (next === current) return undefined;
        const data = withWorkspaces(next);
        if (JSON.stringify(data) === JSON.stringify(current)) return undefined;
        yield* Effect.try({ try: () => database.save(current, data), catch: e => recovery(path, e) });
        yield* Ref.set(state, data);
        return { before: current, after: data };
      }));
      if (!change) return;
      // Outside the lock, so a listener may read the registry; it reads at least this write.
      // The write is saved either way: a failing listener is logged, never reported as a failed write.
      yield* Effect.forEach([...listeners], listener => listener(change.before, change.after).pipe(
        Effect.catchCause(cause => Effect.logWarning("registry change listener failed", cause))), { discard: true });
    }).pipe(Effect.uninterruptible);
    const now = () => new Date().toISOString();
    const isSession = (cwd: string, sessionId: string) => (t: SessionEntry) => t.cwd === cwd && t.sessionId === sessionId;

    const workspace = (id: string) => Effect.flatMap(Ref.get(state), d => {
      const found = d.workspaces.find(w => w.id === id);
      return found ? Effect.succeed(found) : Effect.fail(new RegistryLookupError({ subject: "workspace", detail: "Workspace is not registered. Refresh the folder list." }));
    });

    return Registry.of({
      get: Ref.get(state),
      onChange: listener => Effect.acquireRelease(Effect.sync(() => { listeners.add(listener); }), () => Effect.sync(() => { listeners.delete(listener); })),
      workspace,
      sessionIn: (workspaceId, sessionId) => Effect.flatMap(Ref.get(state), d => {
        const found = d.workspaces.find(w => w.id === workspaceId);
        const session = found && d.sessions.find(isSession(found.path, sessionId));
        return found && session ? Effect.succeed({ workspace: found, session })
          : Effect.fail(new RegistryLookupError({ subject: "session", detail: "Session is not registered in this workspace. Refresh the session list." }));
      }),
      requireFolder: path => Effect.flatMap(Ref.get(state), d => d.folders.includes(path) ? Effect.void
        : Effect.fail(new RegistryLookupError({ subject: "folder", detail: "Select a registered folder first." }))),
      requireActiveProject: id => Effect.flatMap(Ref.get(state), d => {
        const project = d.projects.find(p => p.id === id && !p.archived);
        return project ? Effect.succeed(project)
          : Effect.fail(new RegistryLookupError({ subject: "project", detail: "Project is unavailable or archived. Choose a current project before starting." }));
      }),
      saveProject: project => update(d => {
        const parsed = Schema.decodeUnknownSync(Project)({ ...project, archived: d.projects.find(p => p.id === project.id)?.archived ?? false });
        if (!parsed.name.trim()) throw new RegistryError({ detail: "A project needs a name." });
        const next = { ...parsed, name: parsed.name.trim() };
        return { ...d, projects: d.projects.some(p => p.id === next.id)
          ? d.projects.map(p => p.id === next.id ? next : p) : [...d.projects, next] };
      }),
      archiveProject: (id, archived) => update(d => {
        if (!d.projects.some(p => p.id === id)) throw new RegistryError({ detail: "Project is unavailable. Refresh and try again." });
        return { ...d, projects: d.projects.map(p => p.id === id ? { ...p, archived } : p) };
      }),
      assignProject: (cwd, sessionId, projectId) => update(d => {
        if (!d.sessions.some(isSession(cwd, sessionId))) throw new RegistryError({ detail: "Session reference is unavailable. Refresh and try again." });
        if (projectId !== null && !d.projects.some(p => p.id === projectId)) throw new RegistryError({ detail: "Project is unavailable. Refresh and try again." });
        return { ...d, sessions: d.sessions.map(s => isSession(cwd, sessionId)(s) ? { ...s, projectId: projectId ?? undefined } : s) };
      }),
      addFolder: (raw) =>
        Effect.gen(function* () {
          const path = directoryPath(raw);
          if (!existsSync(path) || !statSync(path).isDirectory()) return yield* new RegistryError({ detail: `Not a directory: ${path}` });
          yield* update((d) => (d.folders.includes(path) ? d : { ...d, folders: [...d.folders, path] }));
        }),
      ensureFolder: (raw) =>
        Effect.gen(function* () {
          const path = directoryPath(raw);
          const d = yield* Ref.get(state);
          if (d.folders.includes(path) || d.worktrees.some((w) => w.path === path)) return path;
          if (!existsSync(path) || !statSync(path).isDirectory()) return yield* new RegistryError({ detail: `Not a directory: ${path}` });
          yield* update((x) => x.folders.includes(path) ? x : { ...x, folders: [...x.folders, path] });
          return path;
        }),
      // Closing a folder only hides it; its worktrees and sessions stay registered so
      // starting a session in that directory again brings everything back.
      removeFolder: (path) => update((d) => ({ ...d, folders: d.folders.filter((p) => p !== path) })),
      addWorktree: (entry) =>
        update((d) => (d.worktrees.some((w) => w.path === entry.path) ? d : { ...d, worktrees: [...d.worktrees, entry] })),
      addSession: (cwd, sessionId, title) =>
        update((d) => {
          if (d.sessions.some(isSession(cwd, sessionId))) return d;
          const t = now();
          return { ...d, sessions: [...d.sessions, { cwd, sessionId, title: title?.trim() || undefined, createdAt: t, updatedAt: t, archived: false }] };
        }),
      touchSession: (cwd, sessionId, text) =>
        update((d) => ({
          ...d,
          sessions: d.sessions.map((t) =>
            isSession(cwd, sessionId)(t)
              ? { ...t, updatedAt: now(), title: t.title ?? (text ? text.trim().slice(0, 80) : undefined) }
              : t,
          ),
        })),
      mirrorSession: (cwd, sessionId, facts) => update((d) => {
        const entry = d.sessions.find(isSession(cwd, sessionId));
        if (!entry) return d;
        // Pi owns the name; a session Pi has not named keeps its start name or first prompt.
        const title = facts.sessionName?.trim().slice(0, 200) || entry.title;
        const stats = facts.stats ?? entry.stats;
        if (title === entry.title && JSON.stringify(stats) === JSON.stringify(entry.stats)) return d;
        return { ...d, sessions: d.sessions.map(t => t === entry ? { ...t, title, stats } : t) };
      }),
      setSessionPullRequest: (expected, link) => Effect.gen(function* () {
        let saved = false;
        yield* update(d => {
          const entry = d.sessions.find(isSession(expected.cwd, expected.sessionId));
          if (!entry || entry.createdAt !== expected.createdAt || entry.pullRequest !== expected.pullRequest) return d;
          saved = true;
          return { ...d, sessions: d.sessions.map(t => t === entry ? { ...t, pullRequest: link } : t) };
        });
        return saved;
      }),
      archiveSession: (cwd, sessionId) =>
        update((d) => ({ ...d, sessions: d.sessions.map((t) => (isSession(cwd, sessionId)(t) ? { ...t, archived: true } : t)) })),
      removeSession: (cwd, sessionId) => update((d) => ({ ...d, sessions: d.sessions.filter((t) => !isSession(cwd, sessionId)(t)) })),
    });
  }),
);
