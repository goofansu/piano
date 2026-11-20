import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Context, Data, Effect, Layer, Ref, Schema, type Scope, Semaphore } from "effect";
import { cutText } from "../shared/cutText.ts";
import type { WebhookEvent } from "../shared/webhooks.ts";
import {
  ChangesScope,
  Project,
  SESSION_TITLE_MAX,
  SessionPullRequestLink,
  SessionStats,
  sameSession,
  sessionKey,
  Workspace,
} from "../shared/wire.ts";
import type { CreationAttempt } from "./CreationAttempt.ts";
import { Directories } from "./Directories.ts";
import { directoryPath } from "./PiEnv.ts";
import { openRegistryDatabase } from "./RegistryDatabase.ts";

export class RegistryError extends Data.TaggedError("RegistryError")<{ readonly detail: string }> {
  override get message() {
    return this.detail;
  }
}

export class RegistryLookupError extends Data.TaggedError("RegistryLookupError")<{
  readonly subject: "workspace" | "session" | "folder" | "project";
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}

const PROMPT_TITLE_MAX = 80;

const WorktreeEntry = Schema.Struct({
  folder: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  created: Schema.optional(
    Schema.Struct({
      branch: Schema.String,
      baseBranch: Schema.String,
      commit: Schema.optional(Schema.String),
      instance: Schema.optional(Schema.String),
    }),
  ),
});
export type WorktreeEntry = typeof WorktreeEntry.Type;

const sessionLinkFields = {
  pullRequest: Schema.optional(Schema.NullOr(SessionPullRequestLink)),
};
const SessionLinks = Schema.Struct(sessionLinkFields);
export type SessionLinks = typeof SessionLinks.Type;
export type SessionLinkKey = keyof SessionLinks;

const SessionEntry = Schema.Struct({
  ...sessionLinkFields,
  projectId: Schema.optional(Schema.String),
  cwd: Schema.String,
  sessionId: Schema.String,
  title: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archived: Schema.Boolean,
  retentionVersion: Schema.optional(Schema.Number),
  pinned: Schema.optional(Schema.Boolean),
  changesScope: Schema.optional(ChangesScope),
  stats: Schema.optional(SessionStats),
});
export type SessionEntry = typeof SessionEntry.Type;

export const shownReference = ({
  stats: _stats,
  changesScope: _changesScope,
  retentionVersion: _retentionVersion,
  ...shown
}: SessionEntry): Omit<SessionEntry, "stats" | "changesScope" | "retentionVersion"> => shown;

export const archivable = (entry: SessionEntry) => !entry.archived && !entry.pinned;

const retained = (entry: SessionEntry, archived: boolean): SessionEntry => ({
  ...entry,
  archived,
  retentionVersion: (entry.retentionVersion ?? 0) + 1,
});

const sameReference = (entry: SessionEntry, expected: SessionEntry, link?: SessionLinkKey) =>
  entry.createdAt === expected.createdAt &&
  (entry.retentionVersion ?? 0) === (expected.retentionVersion ?? 0) &&
  entry.archived === expected.archived &&
  (link === undefined || entry[link] === expected[link]);

export interface StoredWebhook {
  readonly id: string;
  readonly url: string;
  readonly token: string | null;
  readonly events: readonly WebhookEvent[];
  readonly active: boolean;
  readonly createdAt: string;
}

export interface StoredVoiceInput {
  readonly enabled: boolean;
  readonly key: string | null;
}

export interface RegistryData {
  readonly version: 2;
  readonly projects: ReadonlyArray<Project>;
  readonly workspaces: ReadonlyArray<Workspace>;
  readonly folders: ReadonlyArray<string>;
  readonly worktrees: ReadonlyArray<WorktreeEntry>;
  readonly sessions: ReadonlyArray<SessionEntry>;
}

export const inOpenFolder = (data: RegistryData, cwd: string): boolean =>
  data.folders.includes(cwd) ||
  data.worktrees.some((w) => w.path === cwd && data.folders.includes(w.folder));

export type SessionById =
  | { readonly _tag: "unique"; readonly entry: SessionEntry }
  | { readonly _tag: "unlisted" }
  | { readonly _tag: "ambiguous"; readonly cwds: ReadonlyArray<string> };

export const sessionById = (data: RegistryData, sessionId: string): SessionById => {
  const matches = data.sessions.filter((s) => s.sessionId === sessionId);
  if (matches.length === 1) return { _tag: "unique", entry: matches[0]! };
  return matches.length
    ? { _tag: "ambiguous", cwds: matches.map((s) => s.cwd) }
    : { _tag: "unlisted" };
};

export const DEFAULT_DB_PATH = resolve(
  join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "piano", "piano.db"),
);
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
  const folderOf = (path: string) => parents.get(path) ?? path;
  let changed = false;
  const workspaces = data.workspaces.map((w) => {
    const folder = folderOf(w.path);
    if (folder === w.folder) return w;
    changed = true;
    return { ...w, folder };
  });
  for (const path of candidates) {
    if (!paths.has(path)) {
      paths.add(path);
      changed = true;
      workspaces.push({ id: randomUUID(), path, folder: folderOf(path) });
    }
  }
  return changed ? { ...data, workspaces } : data;
}
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
const requireDirectory = (raw: string) =>
  Directories.require(raw).pipe(
    Effect.mapError((error) => new RegistryError({ detail: error.detail })),
  );

export type RegistryListener = (before: RegistryData, after: RegistryData) => Effect.Effect<void>;

export class Registry extends Context.Service<
  Registry,
  {
    readonly get: Effect.Effect<RegistryData>;
    readonly creationAttempt: (
      id: string,
    ) => Effect.Effect<CreationAttempt | undefined, RegistryError>;
    readonly claimCreation: (attempt: CreationAttempt) => Effect.Effect<boolean, RegistryError>;
    readonly saveCreation: (attempt: CreationAttempt) => Effect.Effect<void, RegistryError>;
    readonly webhooks: Effect.Effect<readonly StoredWebhook[], RegistryError>;
    readonly saveWebhook: (hook: StoredWebhook) => Effect.Effect<void, RegistryError>;
    readonly removeWebhook: (id: string) => Effect.Effect<void, RegistryError>;
    readonly voiceInput: Effect.Effect<StoredVoiceInput, RegistryError>;
    readonly saveVoiceInput: (voice: StoredVoiceInput) => Effect.Effect<void, RegistryError>;
    readonly onChange: (listener: RegistryListener) => Effect.Effect<void, never, Scope.Scope>;
    readonly workspace: (id: string) => Effect.Effect<Workspace, RegistryLookupError>;
    readonly sessionIn: (
      workspaceId: string,
      sessionId: string,
    ) => Effect.Effect<
      { readonly workspace: Workspace; readonly session: SessionEntry },
      RegistryLookupError
    >;
    readonly requireFolder: (path: string) => Effect.Effect<void, RegistryLookupError>;
    readonly requireProject: (id: string) => Effect.Effect<Project, RegistryLookupError>;
    readonly saveProject: (
      project: Pick<Project, "id" | "name" | "instructions">,
      assign?: { readonly cwd: string; readonly sessionId: string },
    ) => Effect.Effect<void, RegistryError>;
    readonly updateProject: (
      id: string,
      change: { readonly name?: string; readonly instructions?: string | null },
    ) => Effect.Effect<void, RegistryError>;
    readonly setProjectDone: (id: string, done: boolean) => Effect.Effect<void, RegistryError>;
    readonly deleteProject: (id: string) => Effect.Effect<void, RegistryError>;
    readonly assignProject: (
      cwd: string,
      sessionId: string,
      projectId: string | null,
    ) => Effect.Effect<void, RegistryError>;
    readonly addFolder: (path: string) => Effect.Effect<string, RegistryError>;
    readonly removeFolder: (path: string) => Effect.Effect<void, RegistryError>;
    readonly addWorktree: (
      entry: Omit<WorktreeEntry, "created">,
    ) => Effect.Effect<void, RegistryError>;
    readonly recordCreatedWorktree: (entry: {
      readonly folder: string;
      readonly path: string;
      readonly branch: string;
      readonly baseBranch: string;
      readonly commit: string;
      readonly instance: string;
    }) => Effect.Effect<void, RegistryError>;
    readonly observeWorktreeBranches: (
      observed: ReadonlyArray<{ readonly path: string; readonly branch: string }>,
    ) => Effect.Effect<void, RegistryError>;
    readonly addSession: (
      cwd: string,
      sessionId: string,
      title?: string,
      projectId?: string,
    ) => Effect.Effect<void, RegistryError>;
    readonly touchSession: (
      cwd: string,
      sessionId: string,
      text?: string,
    ) => Effect.Effect<void, RegistryError>;
    readonly mirrorSession: (
      cwd: string,
      sessionId: string,
      facts: { readonly sessionName?: string; readonly stats?: SessionStats },
    ) => Effect.Effect<void, RegistryError>;
    readonly current: (
      expected: SessionEntry,
      link?: SessionLinkKey,
    ) => Effect.Effect<SessionEntry | undefined>;
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
    readonly setSessionChangesScope: (
      cwd: string,
      sessionId: string,
      scope: ChangesScope | undefined,
    ) => Effect.Effect<void, RegistryError>;
    readonly archiveSession: (cwd: string, sessionId: string) => Effect.Effect<void, RegistryError>;
    readonly unarchiveSession: (
      cwd: string,
      sessionId: string,
    ) => Effect.Effect<void, RegistryError>;
    readonly archiveSessions: (
      expected: ReadonlyArray<SessionEntry>,
    ) => Effect.Effect<number, RegistryError>;
    readonly archivableCount: (expected: ReadonlyArray<SessionEntry>) => Effect.Effect<number>;
    readonly removeSession: (
      cwd: string,
      sessionId: string,
      reopened?: { readonly projectId: string; readonly doneAt: string },
    ) => Effect.Effect<void, RegistryError>;
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
      yield* Effect.try({
        try: () => {
          const stored = decode(database.data);
          const data = withWorkspaces(stored, []);
          if (data !== stored) database.save(stored, data);
          return data;
        },
        catch: (e) => recovery(path, e),
      }),
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
    const titleOf = (text: string | undefined, max = SESSION_TITLE_MAX) => {
      const trimmed = text?.trim();
      if (!trimmed) return undefined;
      return cutText(trimmed, max).trim() || undefined;
    };
    const isSession = (cwd: string, sessionId: string) => (t: SessionEntry) =>
      sameSession(t, { cwd, sessionId });
    const currentIn = (d: RegistryData, expected: SessionEntry, link?: SessionLinkKey) => {
      const entry = d.sessions.find(isSession(expected.cwd, expected.sessionId));
      return entry && sameReference(entry, expected, link) ? entry : undefined;
    };
    const archiveIn = (d: RegistryData, expected: ReadonlyArray<SessionEntry>) => {
      let count = 0;
      const candidates = new Map(expected.map((s) => [sessionKey(s.cwd, s.sessionId), s]));
      const sessions = d.sessions.map((s) => {
        const before = candidates.get(sessionKey(s.cwd, s.sessionId));
        if (!before || !archivable(s) || !sameReference(s, before)) return s;
        count++;
        return retained(s, true);
      });
      return { data: { ...d, sessions }, count };
    };
    const changeableIn = (d: RegistryData, cwd: string, sessionId: string) => {
      const entry = d.sessions.find(isSession(cwd, sessionId));
      if (!entry || entry.archived)
        throw new RegistryError({
          detail: "Session reference is unavailable. Refresh and try again.",
        });
      return entry;
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
      creationAttempt: (id) =>
        Effect.try({ try: () => database.creationAttempt(id), catch: (e) => recovery(path, e) }),
      claimCreation: (attempt) =>
        Effect.try({ try: () => database.claimCreation(attempt), catch: (e) => recovery(path, e) }),
      saveCreation: (attempt) =>
        Effect.try({ try: () => database.saveCreation(attempt), catch: (e) => recovery(path, e) }),
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
      voiceInput: Effect.try({
        try: database.voiceInput,
        catch: () => new RegistryError({ detail: "Could not read voice input." }),
      }),
      saveVoiceInput: Effect.fn("Registry.saveVoiceInput")(function* (voice) {
        yield* Effect.try({
          try: () => database.saveVoiceInput(voice),
          catch: () => new RegistryError({ detail: "Could not save voice input." }),
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
          const assigned = assign && changeableIn(d, assign.cwd, assign.sessionId);
          if (d.projects.some((p) => p.id === parsed.id))
            throw new RegistryError({ detail: "Project already exists. Refresh and try again." });
          const instructions = parsed.instructions?.trim();
          const next = {
            id: parsed.id,
            name: parsed.name.trim(),
            ...(instructions ? { instructions } : {}),
          };
          const projects = [...d.projects, next];
          const sessions = assigned
            ? d.sessions.map((s) => (s === assigned ? { ...s, projectId: next.id } : s))
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
      setProjectDone: (id, done) =>
        update((d) => {
          const project = d.projects.find((p) => p.id === id);
          if (!project)
            throw new RegistryError({ detail: "Project is unavailable. Refresh and try again." });
          if (done === (project.doneAt !== undefined)) return d;
          const { doneAt: _, ...open } = project;
          const next = done ? { ...open, doneAt: now() } : open;
          return { ...d, projects: d.projects.map((p) => (p.id === id ? next : p)) };
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
          const entry = changeableIn(d, cwd, sessionId);
          if (projectId !== null && !d.projects.some((p) => p.id === projectId))
            throw new RegistryError({ detail: "Project is unavailable. Refresh and try again." });
          return {
            ...d,
            sessions: d.sessions.map((s) =>
              s === entry ? { ...s, projectId: projectId ?? undefined } : s,
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
      removeFolder: (path) =>
        update((d) => ({ ...d, folders: d.folders.filter((p) => p !== path) })),
      addWorktree: (entry) =>
        update((d) =>
          d.worktrees.some((w) => w.path === entry.path)
            ? d
            : { ...d, worktrees: [...d.worktrees, entry] },
        ),
      recordCreatedWorktree: ({ folder, path, branch, baseBranch, commit, instance }) => {
        const entry: WorktreeEntry = {
          folder,
          path,
          branch,
          created: { branch, baseBranch, commit, instance },
        };
        return update((d) =>
          d.worktrees.some((w) => w.path === entry.path)
            ? { ...d, worktrees: d.worktrees.map((w) => (w.path === entry.path ? entry : w)) }
            : { ...d, worktrees: [...d.worktrees, entry] },
        );
      },
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
          const projects = d.projects.map((p) => {
            if (p.id !== projectId || p.doneAt === undefined) return p;
            const { doneAt: _, ...open } = p;
            return open;
          });
          return {
            ...d,
            projects,
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
                  title: t.title ?? titleOf(text, PROMPT_TITLE_MAX),
                }
              : t,
          ),
        })),
      mirrorSession: (cwd, sessionId, facts) =>
        update((d) => {
          const entry = d.sessions.find(isSession(cwd, sessionId));
          if (!entry) return d;
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
          if (!entry || entry.archived) return d;
          const next: SessionEntry = { ...entry, [link]: value };
          saved = next;
          return { ...d, sessions: d.sessions.map((s) => (s === entry ? next : s)) };
        });
        return saved;
      }),
      pinSession: Effect.fn("Registry.pinSession")(function* (cwd, sessionId, pinned) {
        yield* update((d) => {
          const entry = changeableIn(d, cwd, sessionId);
          if (!!entry.pinned === pinned) return d;
          return {
            ...d,
            sessions: d.sessions.map((s) =>
              s === entry ? { ...s, pinned: pinned || undefined } : s,
            ),
          };
        });
      }),
      setSessionChangesScope: Effect.fn("Registry.setSessionChangesScope")(
        function* (cwd, sessionId, scope) {
          yield* update((d) => {
            const entry = changeableIn(d, cwd, sessionId);
            if (entry.changesScope === scope) return d;
            return {
              ...d,
              sessions: d.sessions.map((s) => (s === entry ? { ...s, changesScope: scope } : s)),
            };
          });
        },
      ),
      archiveSession: (cwd, sessionId) =>
        update((d) => ({
          ...d,
          sessions: d.sessions.map((t) =>
            isSession(cwd, sessionId)(t) && !t.archived ? retained(t, true) : t,
          ),
        })),
      unarchiveSession: (cwd, sessionId) =>
        update((d) => {
          const entry = d.sessions.find(isSession(cwd, sessionId));
          if (!entry?.archived)
            throw new RegistryError({
              detail: "Session reference is unavailable. Refresh and try again.",
            });
          return {
            ...d,
            sessions: d.sessions.map((s) => (s === entry ? retained(s, false) : s)),
          };
        }),
      archiveSessions: Effect.fn("Registry.archiveSessions")(function* (expected) {
        let count = 0;
        yield* update((d) => {
          const archived = archiveIn(d, expected);
          count = archived.count;
          return archived.data;
        });
        return count;
      }),
      archivableCount: (expected) =>
        Effect.map(Ref.get(state), (d) => archiveIn(d, expected).count),
      removeSession: (cwd, sessionId, reopened) =>
        update((d) => {
          const at = d.sessions.findIndex(isSession(cwd, sessionId));
          const sessions = d.sessions.filter((t) => !isSession(cwd, sessionId)(t));
          const later =
            !reopened ||
            at < 0 ||
            d.sessions.slice(at + 1).some((t) => t.projectId === reopened.projectId);
          return {
            ...d,
            sessions,
            projects: later
              ? d.projects
              : d.projects.map((p) =>
                  p.id === reopened.projectId && p.doneAt === undefined
                    ? { ...p, doneAt: reopened.doneAt }
                    : p,
                ),
          };
        }),
    });
  }),
);
