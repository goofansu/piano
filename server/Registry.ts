/**
 * What piano knows about: projects, the worktrees created through piano, and
 * the sessions started through piano. Stored at ~/.config/piano/config.json
 * (override with PIANO_CONFIG). Pi's own session store is only consulted to
 * load a session's history; it is never scanned to populate the sidebar.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Context, Data, Effect, Layer, Ref, Semaphore } from "effect";
import { expandHome } from "./PiEnv.ts";

export class RegistryError extends Data.TaggedError("RegistryError")<{ readonly detail: string }> {}

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
  readonly projects: ReadonlyArray<string>;
  readonly worktrees: ReadonlyArray<WorktreeEntry>;
  readonly sessions: ReadonlyArray<SessionEntry>;
}

export const CONFIG_PATH = process.env.PIANO_CONFIG ?? join(homedir(), ".config", "piano", "config.json");

const empty: RegistryData = { projects: [], worktrees: [], sessions: [] };

function read(): RegistryData {
  try {
    if (!existsSync(CONFIG_PATH)) return empty;
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<RegistryData>;
    const legacy = raw as { threads?: SessionEntry[] }; // config files written before "thread" became "session"
    return {
      projects: Array.isArray(raw.projects) ? raw.projects.filter((p): p is string => typeof p === "string") : [],
      worktrees: Array.isArray(raw.worktrees) ? raw.worktrees : [],
      sessions: Array.isArray(raw.sessions ?? legacy.threads)
        ? (raw.sessions ?? legacy.threads ?? []).map((t) => ({ ...t, archived: !!t.archived }))
        : [],
    };
  } catch {
    return empty;
  }
}

function write(data: RegistryData): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

export class Registry extends Context.Service<
  Registry,
  {
    readonly get: Effect.Effect<RegistryData>;
    readonly addProject: (path: string) => Effect.Effect<void, RegistryError>;
    /** Make sure a directory is usable as a session cwd: a project root or a registered worktree. Adds it as a project otherwise. */
    readonly ensureProject: (path: string) => Effect.Effect<string, RegistryError>;
    readonly removeProject: (path: string) => Effect.Effect<void>;
    readonly addWorktree: (entry: WorktreeEntry) => Effect.Effect<void>;
    /** Register a session started through piano. Idempotent. */
    readonly addSession: (cwd: string, sessionId: string, title?: string) => Effect.Effect<void>;
    /** Bump a session's activity time; sets the title from the first prompt when none was given. */
    readonly touchSession: (cwd: string, sessionId: string, text?: string) => Effect.Effect<void>;
    readonly archiveSession: (cwd: string, sessionId: string) => Effect.Effect<void>;
  }
>()("piano/Registry") {}

export const RegistryLive = Layer.effect(
  Registry,
  Effect.gen(function* () {
    const state = yield* Ref.make(read());
    const lock = yield* Semaphore.make(1);
    const update = (f: (d: RegistryData) => RegistryData) =>
      Semaphore.withPermits(lock, 1)(
        Ref.updateAndGet(state, f).pipe(Effect.flatMap((d) => Effect.sync(() => write(d)))),
      );
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
      removeProject: (path) =>
        update((d) => ({
          ...d,
          projects: d.projects.filter((p) => p !== path),
          worktrees: d.worktrees.filter((w) => w.project !== path),
        })),
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
    });
  }),
);
