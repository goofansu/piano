/**
 * Wire vocabulary shared by the server and the React client.
 *
 * SessionEvent / SessionAction are the native language of the PiSessions module:
 * a browser client consumes SessionEvents and produces SessionActions, and the
 * WebSocket layer is a pass-through. Everything is an effect Schema so both
 * sides decode with the same definitions.
 */
import { Schema } from "effect";

// ── Session rendering ────────────────────────────────────────────────────────

export const ToolCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.String,
});

export const RenderMsg = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "tool_result"]),
  text: Schema.String,
  toolCalls: Schema.optional(Schema.Array(ToolCall)),
  toolName: Schema.optional(Schema.String),
  toolCallId: Schema.optional(Schema.String),
  isError: Schema.optional(Schema.Boolean),
  model: Schema.optional(Schema.String),
});
export type RenderMsg = typeof RenderMsg.Type;

export const Dialog = Schema.Struct({
  id: Schema.String,
  method: Schema.Literals(["select", "confirm", "input", "editor"]),
  title: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Schema.String)),
  placeholder: Schema.optional(Schema.String),
  prefill: Schema.optional(Schema.String),
});
export type Dialog = typeof Dialog.Type;

export const ContextUsage = Schema.Struct({
  tokens: Schema.NullOr(Schema.Number),
  contextWindow: Schema.Number,
  percent: Schema.NullOr(Schema.Number),
});
export type ContextUsage = typeof ContextUsage.Type;

export const SessionState = Schema.Struct({
  sessionId: Schema.String,
  sessionFile: Schema.optional(Schema.String),
  sessionName: Schema.optional(Schema.String),
  /** "provider/id" */
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.String),
  isStreaming: Schema.Boolean,
  /** Current context-window usage, refreshed after each turn. */
  context: Schema.optional(ContextUsage),
  /** Session cost in USD so far. */
  cost: Schema.optional(Schema.Number),
});
export type SessionState = typeof SessionState.Type;

export const Snapshot = Schema.Struct({
  state: SessionState,
  messages: Schema.Array(RenderMsg),
  dialogs: Schema.Array(Dialog),
});
export type Snapshot = typeof Snapshot.Type;

/** Everything a browser client renders for one session. A subscription always starts with `snapshot`. */
export const SessionEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", { snapshot: Snapshot }),
  Schema.TaggedStruct("state", { state: SessionState }),
  Schema.TaggedStruct("message_update", { message: RenderMsg }),
  Schema.TaggedStruct("message_end", { message: RenderMsg }),
  Schema.TaggedStruct("tool_start", { toolCallId: Schema.String, toolName: Schema.String }),
  Schema.TaggedStruct("tool_end", { toolCallId: Schema.String, isError: Schema.Boolean }),
  Schema.TaggedStruct("dialog", { dialog: Dialog }),
  Schema.TaggedStruct("dialog_resolved", { id: Schema.String }),
  Schema.TaggedStruct("notice", { level: Schema.Literals(["info", "warning", "error"]), message: Schema.String }),
  Schema.TaggedStruct("closed", { reason: Schema.String }),
]);
export type SessionEvent = typeof SessionEvent.Type;

export const ThinkingLevel = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ThinkingLevel = typeof ThinkingLevel.Type;

/** Everything a browser client may do to a running session. */
export const SessionAction = Schema.Union([
  Schema.TaggedStruct("prompt", { text: Schema.String }),
  Schema.TaggedStruct("abort", {}),
  Schema.TaggedStruct("set_model", { model: Schema.String }),
  Schema.TaggedStruct("set_thinking_level", { level: ThinkingLevel }),
  Schema.TaggedStruct("answer", {
    id: Schema.String,
    value: Schema.optional(Schema.String),
    confirmed: Schema.optional(Schema.Boolean),
    cancelled: Schema.optional(Schema.Boolean),
  }),
]);
export type SessionAction = typeof SessionAction.Type;

// ── Sidebar views ───────────────────────────────────────────────────────────

export const SessionInfo = Schema.Struct({
  sessionId: Schema.String,
  /** Directory the session runs in: the project root or one of its worktrees. */
  cwd: Schema.String,
  /** Branch of that worktree; empty for the project root. */
  branch: Schema.String,
  title: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  hosted: Schema.Boolean,
  streaming: Schema.Boolean,
});
export type SessionInfo = typeof SessionInfo.Type;

export const WorktreeView = Schema.Struct({
  branch: Schema.String,
  path: Schema.String,
  main: Schema.Boolean,
});
export type WorktreeView = typeof WorktreeView.Type;

export const ProjectView = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  /** The root first, then worktrees created through piano. */
  worktrees: Schema.Array(WorktreeView),
  /** All of the project's sessions across its worktrees, most recent first. */
  sessions: Schema.Array(SessionInfo),
});
export type ProjectView = typeof ProjectView.Type;

export const ModelChoice = Schema.Struct({
  ref: Schema.String,
  provider: Schema.String,
  id: Schema.String,
  name: Schema.optional(Schema.String),
  reasoning: Schema.Boolean,
  contextWindow: Schema.Number,
  enabled: Schema.Boolean,
  /** Efforts this model accepts, in ascending order; `["off"]` when it cannot reason. */
  thinkingLevels: Schema.Array(ThinkingLevel),
});
export type ModelChoice = typeof ModelChoice.Type;

export const ModelCatalog = Schema.Struct({
  models: Schema.Array(ModelChoice),
  defaultModel: Schema.optional(Schema.String),
  defaultThinkingLevel: Schema.optional(Schema.String),
  fetchedAt: Schema.String,
  error: Schema.optional(Schema.String),
});
export type ModelCatalog = typeof ModelCatalog.Type;

export const DirEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  /** Set when the folder is a git checkout: its HEAD commit subject. */
  gitSubject: Schema.optional(Schema.String),
});
export const DirListing = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  home: Schema.String,
  /** HEAD subject when `path` itself is inside a git checkout. */
  gitSubject: Schema.optional(Schema.String),
  /** Top-level directory of the checkout containing `path`, when any. */
  gitRoot: Schema.optional(Schema.String),
  entries: Schema.Array(DirEntry),
});
export type DirListing = typeof DirListing.Type;

export const HostInfo = Schema.Struct({ cwd: Schema.String, sessionId: Schema.String, streaming: Schema.Boolean });
export type HostInfo = typeof HostInfo.Type;

// ── WebSocket protocol ──────────────────────────────────────────────────────

export const StartOptions = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(ThinkingLevel),
  name: Schema.optional(Schema.String),
});
export type StartOptions = typeof StartOptions.Type;

export const ClientMessage = Schema.Union([
  Schema.TaggedStruct("projects", {}),
  Schema.TaggedStruct("models", {}),
  Schema.TaggedStruct("add_project", { path: Schema.String }),
  Schema.TaggedStruct("remove_project", { path: Schema.String }),
  Schema.TaggedStruct("create_worktree", { project: Schema.String, branch: Schema.String, hooks: Schema.Boolean }),
  Schema.TaggedStruct("select", { cwd: Schema.String, sessionId: Schema.NullOr(Schema.String) }),
  /** Create and start a session in a directory (registering it as a project when needed) and send its first prompt. */
  Schema.TaggedStruct("create_session", { cwd: Schema.String, options: StartOptions, text: Schema.optional(Schema.String) }),
  /** Act on the selected session. `start` carries the options used to start pi when it is not running. */
  Schema.TaggedStruct("act", { action: SessionAction, start: Schema.optional(StartOptions) }),
  /** Hide a session from the sidebar (and stop pi for it if running). */
  Schema.TaggedStruct("archive_session", { cwd: Schema.String, sessionId: Schema.String }),
  /** Stop pi for a session, delete its file from pi's session store, and forget it. */
  Schema.TaggedStruct("delete_session", { cwd: Schema.String, sessionId: Schema.String }),
]);
export type ClientMessage = typeof ClientMessage.Type;

export const ServerMessage = Schema.Union([
  Schema.TaggedStruct("projects", { projects: Schema.Array(ProjectView) }),
  Schema.TaggedStruct("models", { catalog: ModelCatalog }),
  Schema.TaggedStruct("hosts", { hosts: Schema.Array(HostInfo) }),
  /** Result of `select`: the session now shown. `hosted` false means a read-only peek of the session file. */
  Schema.TaggedStruct("selected", {
    cwd: Schema.String,
    sessionId: Schema.NullOr(Schema.String),
    hosted: Schema.Boolean,
    snapshot: Snapshot,
  }),
  Schema.TaggedStruct("session", { event: SessionEvent }),
  Schema.TaggedStruct("worktree_created", { project: Schema.String, path: Schema.String, branch: Schema.String }),
  Schema.TaggedStruct("error", { message: Schema.String }),
  Schema.TaggedStruct("toast", { message: Schema.String }),
]);
export type ServerMessage = typeof ServerMessage.Type;

export const ClientMessageJson = Schema.fromJsonString(ClientMessage);
export const ServerMessageJson = Schema.fromJsonString(ServerMessage);
export const decodeClientMessage = Schema.decodeUnknownSync(ClientMessageJson);
export const encodeServerMessage = Schema.encodeSync(ServerMessageJson);
export const decodeServerMessage = Schema.decodeUnknownSync(ServerMessageJson);
export const encodeClientMessage = Schema.encodeSync(ClientMessageJson);
