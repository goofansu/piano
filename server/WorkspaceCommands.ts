/**
 * Workspace and session commands: the domain steps behind the browser's create, rename,
 * archive and delete requests. Registry holds references only (INV-01); SessionHosts owns
 * the single child per session (INV-02); Worktrees owns Git and Worktrunk. The requesting
 * client's SessionViewer attaches what it opens, through `SessionClient`.
 */
import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import type { Attachment, StartOptions, WorktreeResult } from "../shared/wire.ts";
import type { PiSession, PiSessionError } from "./PiSessions.ts";
import { Registry, type RegistryError, type RegistryLookupError } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { createWorktree, listWorktrees, WorktreeError } from "./Worktrees.ts";

export type ReadyWorktree = Extract<WorktreeResult, { status: "ready" }>;

export interface CreateSessionRequest {
  readonly cwd: string;
  readonly projectId?: string;
  readonly options: StartOptions;
  readonly text?: string;
  readonly attachments?: ReadonlyArray<Attachment>;
}

/** How the requesting connection takes part: it attaches the opened session and signals that the sidebar changed. */
export interface SessionClient<E, R> {
  /** Opens the session and shows it if the client still has this new session selected. */
  readonly attach: (open: Effect.Effect<PiSession, PiSessionError>) => Effect.Effect<PiSession, E | PiSessionError, R>;
  readonly published: Effect.Effect<void, E, R>;
}

export type RetireMode = "archive" | "delete";

export class WorkspaceCommands extends Context.Service<WorkspaceCommands, {
  /** Register an existing checkout of a registered folder. */
  readonly addWorktree: (folder: string, path: string) => Effect.Effect<ReadyWorktree, WorktreeError | RegistryError>;
  /** Create a new branch checkout through Worktrunk and register it. */
  readonly createWorktree: (folder: string, branch: string, options: { readonly hooks?: boolean }) => Effect.Effect<ReadyWorktree, WorktreeError | RegistryError>;
  /** Start a new session; the registry reference and project are written before any prompt reaches Pi. */
  readonly createSession: <E, R>(request: CreateSessionRequest, client: SessionClient<E, R>) => Effect.Effect<PiSession, E | PiSessionError | RegistryError | RegistryLookupError, R>;
  /** Pi owns the name, so a stopped session is started for it; returns the mirrored title. */
  readonly renameSession: (cwd: string, sessionId: string, title: string) => Effect.Effect<string, PiSessionError | RegistryError>;
  /** Stop Pi, then archive the reference or delete Pi's history and the reference. */
  readonly retireSession: (cwd: string, sessionId: string, mode: RetireMode) => Effect.Effect<void, PiSessionError>;
}>()("piano/WorkspaceCommands") {}

export const WorkspaceCommandsLive = Layer.effect(WorkspaceCommands, Effect.gen(function* () {
  const registry = yield* Registry;
  const hosts = yield* SessionHosts;

  const registered = (folder: string) => registry.requireFolder(folder).pipe(
    Effect.catchTag("RegistryLookupError", e => Effect.fail(new WorktreeError({ detail: e.detail }))));
  const record = (result: ReadyWorktree) => Effect.gen(function* () {
    if (result.path !== result.folder) yield* registry.addWorktree({ folder: result.folder, path: result.path, branch: result.branch ?? "" });
    return result;
  });

  return WorkspaceCommands.of({
    addWorktree: (folder, path) => Effect.gen(function* () {
      yield* registered(folder);
      const discovery = yield* listWorktrees(folder);
      if (discovery.status !== "ready") return yield* new WorktreeError({ detail: discovery.status === "error" ? discovery.detail : "This folder is non-Git." });
      const w = discovery.worktrees.find(w => w.path === path);
      if (!w || w.prunable) return yield* new WorktreeError({ detail: "This checkout is absent or unavailable. Refresh discovery and inspect it before selecting." });
      return yield* record({ status: "ready", folder, path: w.path, branch: w.branch });
    }),

    createWorktree: (folder, branch, options) => Effect.gen(function* () {
      yield* registered(folder);
      const w = yield* createWorktree(folder, branch.trim(), { hooks: options.hooks });
      return yield* record({ status: "ready", folder, path: w.path, branch: w.branch, creation: { baseBranch: w.baseBranch, hooks: w.hooks } });
    }),

    createSession: (request, client) => Effect.gen(function* () {
      if (request.projectId) yield* registry.requireActiveProject(request.projectId);
      const cwd = yield* registry.ensureFolder(request.cwd);
      const { model, thinkingLevel, name } = request.options;
      // Only a fresh server-generated ID may create a reference; SessionHosts keeps one child per ID.
      const session = yield* client.attach(hosts.open({ cwd, sessionId: randomUUID(), create: true, model, thinkingLevel, name }));
      if (request.projectId) yield* registry.assignProject(session.spec.cwd, session.spec.sessionId, request.projectId);
      yield* client.published;
      const text = request.text?.trim() ?? "";
      if (!text && !request.attachments?.length) return session;
      yield* registry.touchSession(session.spec.cwd, session.spec.sessionId, text);
      yield* client.published;
      yield* session.act({ _tag: "prompt", text, attachments: request.attachments });
      return session;
    }),

    renameSession: (cwd, sessionId, title) => Effect.gen(function* () {
      // The host releases a session started only for this once it is idle.
      const session = (yield* hosts.get(cwd, sessionId)) ?? (yield* hosts.open({ cwd, sessionId }));
      yield* session.act({ _tag: "set_name", name: title });
      const mirrored = (yield* session.state).sessionName ?? title;
      yield* registry.renameSession(session.spec.cwd, session.spec.sessionId, mirrored);
      return mirrored;
    }),

    retireSession: (cwd, sessionId, mode) => mode === "delete" ? hosts.delete(cwd, sessionId) : hosts.archive(cwd, sessionId),
  });
}));
