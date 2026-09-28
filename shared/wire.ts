/**
 * Wire vocabulary shared by the server and the React client.
 *
 * ThreadEvent / ThreadAction are the native language of the PiThreads module:
 * a browser client consumes ThreadEvents and produces ThreadActions, and the
 * WebSocket layer is a pass-through. Everything is an effect Schema so both
 * sides decode with the same definitions.
 */
import { Schema } from "effect";

// ── Thread rendering ────────────────────────────────────────────────────────

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

export const ThreadState = Schema.Struct({
  sessionId: Schema.String,
  sessionFile: Schema.optional(Schema.String),
  sessionName: Schema.optional(Schema.String),
  /** "provider/id" */
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.String),
  isStreaming: Schema.Boolean,
});
export type ThreadState = typeof ThreadState.Type;

export const Snapshot = Schema.Struct({
  state: ThreadState,
  messages: Schema.Array(RenderMsg),
  dialogs: Schema.Array(Dialog),
});
export type Snapshot = typeof Snapshot.Type;

/** Everything a browser client renders for one thread. A subscription always starts with `snapshot`. */
export const ThreadEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", { snapshot: Snapshot }),
  Schema.TaggedStruct("state", { state: ThreadState }),
  Schema.TaggedStruct("message_update", { message: RenderMsg }),
  Schema.TaggedStruct("message_end", { message: RenderMsg }),
  Schema.TaggedStruct("tool_start", { toolCallId: Schema.String, toolName: Schema.String }),
  Schema.TaggedStruct("tool_end", { toolCallId: Schema.String, isError: Schema.Boolean }),
  Schema.TaggedStruct("dialog", { dialog: Dialog }),
  Schema.TaggedStruct("dialog_resolved", { id: Schema.String }),
  Schema.TaggedStruct("notice", { level: Schema.Literals(["info", "warning", "error"]), message: Schema.String }),
  Schema.TaggedStruct("closed", { reason: Schema.String }),
]);
export type ThreadEvent = typeof ThreadEvent.Type;

/** Everything a browser client may do to a running thread. */
export const ThreadAction = Schema.Union([
  Schema.TaggedStruct("prompt", { text: Schema.String }),
  Schema.TaggedStruct("abort", {}),
  Schema.TaggedStruct("set_model", { model: Schema.String }),
  Schema.TaggedStruct("answer", {
    id: Schema.String,
    value: Schema.optional(Schema.String),
    confirmed: Schema.optional(Schema.Boolean),
    cancelled: Schema.optional(Schema.Boolean),
  }),
]);
export type ThreadAction = typeof ThreadAction.Type;

// ── Sidebar views ───────────────────────────────────────────────────────────

export const ThreadInfo = Schema.Struct({
  sessionId: Schema.String,
  path: Schema.String,
  name: Schema.optional(Schema.String),
  firstMessage: Schema.String,
  created: Schema.String,
  modified: Schema.String,
  messageCount: Schema.Number,
  hosted: Schema.Boolean,
  streaming: Schema.Boolean,
});
export type ThreadInfo = typeof ThreadInfo.Type;

export const WorktreeView = Schema.Struct({
  branch: Schema.String,
  path: Schema.String,
  main: Schema.Boolean,
  threads: Schema.Array(ThreadInfo),
});
export type WorktreeView = typeof WorktreeView.Type;

export const ProjectView = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  worktrees: Schema.Array(WorktreeView),
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

export const DirEntry = Schema.Struct({ name: Schema.String, path: Schema.String, git: Schema.Boolean });
export const DirListing = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  home: Schema.String,
  entries: Schema.Array(DirEntry),
});
export type DirListing = typeof DirListing.Type;

export const HostInfo = Schema.Struct({ cwd: Schema.String, sessionId: Schema.String, streaming: Schema.Boolean });
export type HostInfo = typeof HostInfo.Type;

// ── WebSocket protocol ──────────────────────────────────────────────────────

export const StartOptions = Schema.Struct({
  model: Schema.optional(Schema.String),
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
  Schema.TaggedStruct("start", { options: StartOptions }),
  /** Act on the selected thread. `start` lets a prompt start the thread when it is not running. */
  Schema.TaggedStruct("act", { action: ThreadAction, start: Schema.optional(StartOptions) }),
  Schema.TaggedStruct("release", {}),
]);
export type ClientMessage = typeof ClientMessage.Type;

export const ServerMessage = Schema.Union([
  Schema.TaggedStruct("projects", { projects: Schema.Array(ProjectView) }),
  Schema.TaggedStruct("models", { catalog: ModelCatalog }),
  Schema.TaggedStruct("hosts", { hosts: Schema.Array(HostInfo) }),
  /** Result of `select`: the thread now shown. `hosted` false means a read-only peek of the session file. */
  Schema.TaggedStruct("selected", {
    cwd: Schema.String,
    sessionId: Schema.NullOr(Schema.String),
    hosted: Schema.Boolean,
    snapshot: Snapshot,
  }),
  Schema.TaggedStruct("thread", { event: ThreadEvent }),
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
