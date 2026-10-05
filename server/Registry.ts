/**
 * What piano knows about: projects, the worktrees created through piano, and
 * the sessions started through piano. Stored at ~/.config/piano/config.json
 * (override with PIANO_CONFIG). Pi's own session store is only consulted to
 * load a session's history; it is never scanned to populate the sidebar.
 */
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Context, Data, Effect, Layer, Ref, Schema, Semaphore } from "effect";
import { Workspace } from "../shared/wire.ts";
import { expandHome } from "./PiEnv.ts";

export class RegistryError extends Data.TaggedError("RegistryError")<{ readonly detail: string }> {
  override get message() { return this.detail; }
}

export interface WorktreeEntry {
  readonly project: string;
  readonly path: string;
  readonly branch: string;
}

export interface SessionEntry {
  readonly cwd: string;
  readonly sessionId: string;
  readonly title?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archived: boolean;
}

export interface RegistryData {
  readonly version: 1;
  readonly workspaces: ReadonlyArray<Workspace>;
  readonly projects: ReadonlyArray<string>;
  readonly worktrees: ReadonlyArray<WorktreeEntry>;
  readonly sessions: ReadonlyArray<SessionEntry>;
}

export const CONFIG_PATH = process.env.PIANO_CONFIG ?? join(homedir(), ".config", "piano", "config.json");

export const RegistryPath = Context.Reference<string>("piano/RegistryPath", { defaultValue: () => CONFIG_PATH });

const empty: RegistryData = { version: 1, projects: [], worktrees: [], sessions: [], workspaces: [] };
const legacySchema = Schema.Struct({
  projects: Schema.Array(Schema.String),
  worktrees: Schema.Array(Schema.Struct({ project: Schema.String, path: Schema.String, branch: Schema.String })),
  sessions: Schema.Array(Schema.Struct({ cwd: Schema.String, sessionId: Schema.String, title: Schema.optional(Schema.String),
    createdAt: Schema.String, updatedAt: Schema.String, archived: Schema.optional(Schema.Boolean) })),
});
const currentSchema = Schema.Struct({ ...legacySchema.fields, version: Schema.Literal(1), workspaces: Schema.Array(Workspace) });

/** Path references keep their spelling: never move or merge Pi's alias-based history. */
function withWorkspaces(data: RegistryData): RegistryData {
  const workspaces = [...data.workspaces];
  for (const path of [...data.projects, ...data.worktrees.map(w => w.path), ...data.sessions.map(s => s.cwd)]) {
    if (!workspaces.some(w => w.path === path)) workspaces.push({ id: randomUUID(), path, project: data.worktrees.find(w => w.path === path)?.project ?? path });
  }
  return { ...data, workspaces };
}
function read(path: string): RegistryData {
  let text: string;
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("Registry symlinks are not supported for atomic migration. Set PIANO_CONFIG to the actual file path.");
    text = readFileSync(path, "utf8");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty; throw error; }
  const raw = JSON.parse(text);
  const migrating = raw.version === undefined;
  if (raw.sessions && raw.threads) throw new Error("Both sessions and legacy threads are present; resolve the ambiguity manually.");
  const data = Schema.decodeUnknownSync(migrating ? legacySchema : currentSchema)({ ...raw, sessions: raw.sessions ?? raw.threads });
  const initial: RegistryData = { ...data, version: 1, sessions: data.sessions.map(s => ({ ...s, archived: s.archived ?? false })),
    workspaces: migrating ? [] : Schema.decodeUnknownSync(Schema.Array(Workspace))(raw.workspaces) };
  for (const p of [...initial.projects, ...initial.worktrees.flatMap(w => [w.path, w.project]), ...initial.sessions.map(s => s.cwd), ...initial.workspaces.flatMap(w => [w.path, w.project])]) {
    if (!isAbsolute(p)) throw new Error(`Registry path is not absolute: ${p}`);
  }
  if (new Set(initial.workspaces.map(w => w.id)).size !== initial.workspaces.length || new Set(initial.workspaces.map(w => w.path)).size !== initial.workspaces.length || initial.workspaces.some(w => !w.id)) throw new Error("Duplicate or empty workspace identities.");
  const complete = withWorkspaces(initial);
  if (!migrating && complete.workspaces.length !== initial.workspaces.length) throw new Error("Missing workspace identities in version 1 registry.");
  if (migrating) {
    const backup = `${path}.pre-v1-${randomUUID()}.bak`;
    copyFileSync(path, backup, constants.COPYFILE_EXCL);
    chmodSync(backup, 0o600);
    write(path, complete);
  }
  return complete;
}
function write(path: string, data: RegistryData): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
const recovery = (path: string, error: unknown) => new RegistryError({ detail: `Cannot read or persist registry ${path}. It has not been reset. Restore a known-good backup or repair the file before restarting. ${String(error)}` });

export class Registry extends Context.Service<
  Registry,
  {
    readonly get: Effect.Effect<RegistryData>;
    readonly addProject: (path: string) => Effect.Effect<void, RegistryError>;
    /** Make sure a directory is usable as a session cwd: a project root or a registered worktree. Adds it as a project otherwise. */
    readonly ensureProject: (path: string) => Effect.Effect<string, RegistryError>;
    readonly removeProject: (path: string) => Effect.Effect<void, RegistryError>;
    readonly addWorktree: (entry: WorktreeEntry) => Effect.Effect<void, RegistryError>;
    /** Register a session started through piano. Idempotent. */
    readonly addSession: (cwd: string, sessionId: string, title?: string) => Effect.Effect<void, RegistryError>;
    /** Bump a session's activity time; sets the title from the first prompt when none was given. */
    readonly touchSession: (cwd: string, sessionId: string, text?: string) => Effect.Effect<void, RegistryError>;
    readonly archiveSession: (cwd: string, sessionId: string) => Effect.Effect<void, RegistryError>;
    readonly removeSession: (cwd: string, sessionId: string) => Effect.Effect<void, RegistryError>;
  }
>()("piano/Registry") {}

export const RegistryLive = Layer.effect(
  Registry,
  Effect.gen(function* () {
    const path = yield* RegistryPath;
    const state = yield* Ref.make(yield* Effect.try({ try: () => read(path), catch: e => recovery(path, e) }));
    const lock = yield* Semaphore.make(1);
    const update = (f: (d: RegistryData) => RegistryData) =>
      Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        const data = withWorkspaces(f(yield* Ref.get(state)));
        yield* Effect.try({ try: () => write(path, data), catch: e => recovery(path, e) });
        yield* Ref.set(state, data);
      }).pipe(Effect.uninterruptible));
    const now = () => new Date().toISOString();
    const isSession = (cwd: string, sessionId: string) => (t: SessionEntry) => t.cwd === cwd && t.sessionId === sessionId;

    return Registry.of({
      get: Ref.get(state),
      addProject: (raw) =>
        Effect.gen(function* () {
          const path = resolve(expandHome(raw));
          if (!existsSync(path) || !statSync(path).isDirectory()) return yield* new RegistryError({ detail: `Not a directory: ${path}` });
          yield* update((d) => (d.projects.includes(path) ? d : { ...d, projects: [...d.projects, path] }));
        }),
      ensureProject: (raw) =>
        Effect.gen(function* () {
          const path = resolve(expandHome(raw));
          const d = yield* Ref.get(state);
          if (d.projects.includes(path) || d.worktrees.some((w) => w.path === path)) return path;
          if (!existsSync(path) || !statSync(path).isDirectory()) return yield* new RegistryError({ detail: `Not a directory: ${path}` });
          yield* update((x) => ({ ...x, projects: [...x.projects, path] }));
          return path;
        }),
      // Closing a project only hides it; its worktrees and sessions stay registered so
      // starting a session in that directory again brings everything back.
      removeProject: (path) => update((d) => ({ ...d, projects: d.projects.filter((p) => p !== path) })),
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
      archiveSession: (cwd, sessionId) =>
        update((d) => ({ ...d, sessions: d.sessions.map((t) => (isSession(cwd, sessionId)(t) ? { ...t, archived: true } : t)) })),
      removeSession: (cwd, sessionId) => update((d) => ({ ...d, sessions: d.sessions.filter((t) => !isSession(cwd, sessionId)(t)) })),
    });
  }),
);
