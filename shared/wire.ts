/**
 * Wire vocabulary shared by the server and the React client.
 *
 * SessionEvent / SessionAction are the native language of the PiSessions module:
 * a browser client consumes SessionEvents and produces SessionActions, and the
 * WebSocket layer is a pass-through. Everything is an effect Schema so both
 * sides decode with the same definitions.
 */
import { Schema } from "effect";
import { IMAGE_TYPES, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_ATTACHMENT_BYTES, base64Bytes } from "./attachments.ts";

/** Browser input, not a Pi protocol block. Future files get a distinct kind. */
export const Attachment = Schema.Struct({
  kind: Schema.Literal("image"),
  name: Schema.String.check(Schema.isMaxLength(255)),
  mimeType: Schema.Literals(IMAGE_TYPES),
  data: Schema.String.check(Schema.isMaxLength(4 * Math.ceil(MAX_IMAGE_BYTES / 3)), Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/)),
}).check(Schema.makeFilter(a => a.data.length % 4 === 0 && base64Bytes(a.data) > 0 && base64Bytes(a.data) <= MAX_IMAGE_BYTES));
export type Attachment = typeof Attachment.Type;
export const Attachments = Schema.Array(Attachment).check(
  Schema.isMaxLength(MAX_ATTACHMENTS),
  Schema.makeFilter(items => items.reduce((sum, a) => sum + base64Bytes(a.data), 0) <= MAX_ATTACHMENT_BYTES),
);
const attachmentInput = Schema.optional(Attachments);

// ── Session rendering ────────────────────────────────────────────────────────

export const ToolCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.String,
});

/** Latest cumulative usage for ONE response/result, never a streaming delta. */
export const Usage = Schema.Struct({
  input: Schema.Number, output: Schema.Number, cacheRead: Schema.Number, cacheWrite: Schema.Number,
  totalTokens: Schema.Number, cost: Schema.Number,
});
export type Usage = typeof Usage.Type;

/** Execution preview, not a transcript message or an additional billable result. */
export const ToolExecution = Schema.Struct({
  id: Schema.String,
  parentId: Schema.optional(Schema.String),
  name: Schema.String,
  args: Schema.String,
  text: Schema.String,
  status: Schema.Literals(["running", "success", "error", "incomplete"]),
  outputKind: Schema.Literals(["latest-update", "final", "unavailable"]),
});
export type ToolExecution = typeof ToolExecution.Type;

export const ExtensionState = Schema.Struct({
  statuses: Schema.Array(Schema.Struct({ key: Schema.String, text: Schema.String })),
  widgets: Schema.Array(Schema.Struct({ key: Schema.String, lines: Schema.Array(Schema.String), placement: Schema.Literals(["aboveEditor", "belowEditor"]) })),
  title: Schema.optional(Schema.String),
  editorRequest: Schema.optional(Schema.Struct({ id: Schema.String, text: Schema.String })),
});
export type ExtensionState = typeof ExtensionState.Type;

export const RenderMsg = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "tool_result", "context"]),
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(Schema.Struct({ kind: Schema.Literal("image"), url: Schema.String }))),
  toolCalls: Schema.optional(Schema.Array(ToolCall)),
  toolName: Schema.optional(Schema.String),
  toolCallId: Schema.optional(Schema.String),
  isError: Schema.optional(Schema.Boolean),
  /** Physical dispatched model for this response, not the session selection. */
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.String),
  responseModel: Schema.optional(Schema.String),
  usage: Schema.optional(Usage),
  stopReason: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  nestedCalls: Schema.optional(Schema.Array(ToolExecution)),
  nestedCallsComplete: Schema.optional(Schema.Boolean),
});
export type RenderMsg = typeof RenderMsg.Type;

export const Dialog = Schema.Struct({
  id: Schema.String,
  /** One RPC child incarnation; old tabs cannot answer a restarted child's dialog. */
  generation: Schema.String,
  receivedAt: Schema.Number,
  timeoutMs: Schema.optional(Schema.Number),
  /** Host estimate only: Pi does not acknowledge timeout or extension-owned cancellation. */
  deadlineAt: Schema.Number,
  deadlineKind: Schema.Literals(["pi-timeout", "host-recovery"]),
  method: Schema.Literals(["select", "confirm", "input", "editor"]),
  title: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Schema.String)),
  placeholder: Schema.optional(Schema.String),
  prefill: Schema.optional(Schema.String),
});
export type Dialog = typeof Dialog.Type;

/** Local terminal claim and transport observation, never proof Pi consumed the response. */
export const DialogResolution = Schema.Struct({
  id: Schema.String,
  generation: Schema.String,
  reason: Schema.Literals(["answered", "cancelled", "expired", "aborted", "recovery", "exited"]),
  delivery: Schema.Literals(["pending", "written", "uncertain", "not-sent"]),
  detail: Schema.String,
});
export type DialogResolution = typeof DialogResolution.Type;

export const ContextUsage = Schema.Struct({
  tokens: Schema.NullOr(Schema.Number),
  contextWindow: Schema.Number,
  percent: Schema.NullOr(Schema.Number),
});
export type ContextUsage = typeof ContextUsage.Type;

export const QueuedMessage = Schema.Struct({
  kind: Schema.Literals(["steering", "follow-up"]),
  text: Schema.String,
});
export type QueuedMessage = typeof QueuedMessage.Type;

/** Last input's handling, independent of the session's current execution activity.
 * IDs order submissions within this running child; they are not retry/deduplication keys.
 */
export const PromptSubmission = Schema.Struct({
  id: Schema.Number,
  outcome: Schema.Literals(["submitting", "started", "queued", "handled", "rejected", "uncertain"]),
  detail: Schema.optional(Schema.String),
});
export type PromptSubmission = typeof PromptSubmission.Type;

/** Last Pi statistics observation. A bounded cache, never reconstructed from history. */
export const SessionStats = Schema.Struct({
  context: Schema.optional(ContextUsage),
  cost: Schema.optional(Schema.Number),
  tokens: Schema.optional(Schema.Struct({ input: Schema.Number, output: Schema.Number, cacheRead: Schema.Number, cacheWrite: Schema.Number, total: Schema.Number })),
  statsUpdatedAt: Schema.Number,
});
export type SessionStats = typeof SessionStats.Type;

export const SessionState = Schema.Struct({
  sessionId: Schema.String,
  sessionFile: Schema.optional(Schema.String),
  sessionName: Schema.optional(Schema.String),
  /** "provider/id" */
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.String),
  /** A session-level run remains active until agent_settled, not merely agent_end. */
  isStreaming: Schema.Boolean,
  isCompacting: Schema.optional(Schema.Boolean),
  isRetrying: Schema.optional(Schema.Boolean),
  submission: Schema.optional(PromptSubmission),
  dialogResolution: Schema.optional(DialogResolution),
  /** Pi's current pending queue, not submitted prompts inferred by the browser. */
  queuedMessages: Schema.optional(Schema.Array(QueuedMessage)),
  /** Pi's context-window estimate, refreshed at finalized-message and compaction boundaries. */
  context: SessionStats.fields.context,
  /** False only after a successful live observation; cached/uncertain context is last-known. */
  contextIsLastKnown: Schema.optional(Schema.Boolean),
  statsUpdatedAt: Schema.optional(Schema.Number),
  /** Full-session totals from Pi, not a sum of displayed current-context messages. */
  cost: SessionStats.fields.cost,
  tokens: SessionStats.fields.tokens,
  extension: Schema.optional(ExtensionState),
  projectionError: Schema.optional(Schema.String),
  stateRefreshError: Schema.optional(Schema.String),
  statsRefreshError: Schema.optional(Schema.String),
  /** Host observation used for retirement; no pending/unobserved work, not task success. */
  isQuiescent: Schema.optional(Schema.Boolean),
  closedReason: Schema.optional(Schema.String),
});
export type SessionState = typeof SessionState.Type;

export const Snapshot = Schema.Struct({
  state: SessionState,
  messages: Schema.Array(RenderMsg),
  dialogs: Schema.Array(Dialog),
  pending: Schema.optional(RenderMsg),
  tools: Schema.optional(Schema.Array(ToolExecution)),
});
export type Snapshot = typeof Snapshot.Type;

/** Everything a browser client renders for one session. A subscription always starts with `snapshot`. */
export const SessionEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", { snapshot: Snapshot }),
  Schema.TaggedStruct("state", { state: SessionState }),
  Schema.TaggedStruct("queue_update", { messages: Schema.Array(QueuedMessage) }),
  Schema.TaggedStruct("submission", { submission: PromptSubmission }),
  Schema.TaggedStruct("message_update", { message: RenderMsg }),
  Schema.TaggedStruct("message_end", { message: RenderMsg }),
  Schema.TaggedStruct("context", { messages: Schema.Array(RenderMsg) }),
  Schema.TaggedStruct("tool_update", { tool: ToolExecution }),
  Schema.TaggedStruct("dialog", { dialog: Dialog }),
  Schema.TaggedStruct("dialog_resolved", { resolution: DialogResolution }),
  Schema.TaggedStruct("notice", { level: Schema.Literals(["info", "warning", "error"]), message: Schema.String }),
  Schema.TaggedStruct("closed", { reason: Schema.String }),
]);
export type SessionEvent = typeof SessionEvent.Type;

/** Ordered within one child incarnation, never a historical replay cursor. */
export const SessionCursor = Schema.Struct({
  cwd: Schema.String, sessionId: Schema.String, generation: Schema.String, sequence: Schema.Number,
});
export type SessionCursor = typeof SessionCursor.Type;
export type SessionFrame = SessionEvent & { readonly cursor: SessionCursor };

export const ThinkingLevel = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ThinkingLevel = typeof ThinkingLevel.Type;

/** Everything a browser client may do to a running session. */
export const SessionAction = Schema.Union([
  Schema.TaggedStruct("prompt", { text: Schema.String, attachments: attachmentInput }),
  Schema.TaggedStruct("steer", { text: Schema.String, attachments: attachmentInput }),
  Schema.TaggedStruct("abort", {}),
  Schema.TaggedStruct("restore_queue", {}),
  Schema.TaggedStruct("set_model", { model: Schema.String }),
  Schema.TaggedStruct("set_thinking_level", { level: ThinkingLevel }),
  Schema.TaggedStruct("answer", {
    id: Schema.String,
    generation: Schema.String,
    value: Schema.optional(Schema.String),
    confirmed: Schema.optional(Schema.Boolean),
    cancelled: Schema.optional(Schema.Boolean),
  }),
]);
export type SessionAction = typeof SessionAction.Type;

/** A command result for its caller, not a broadcast session event. */
export const SessionActionResult = Schema.TaggedStruct("queue_restored", {
  messages: Schema.Array(QueuedMessage),
});
export type SessionActionResult = typeof SessionActionResult.Type;

// ── Workspace captures ──────────────────────────────────────────────────────

export const Workspace = Schema.Struct({ id: Schema.String, project: Schema.String, path: Schema.String });
export type Workspace = typeof Workspace.Type;
export const RevisionFile = Schema.Struct({
  path: Schema.String, mode: Schema.Literals(["100644", "100755", "120000"]),
  sha256: Schema.String, bytes: Schema.Number,
});
export type RevisionFile = typeof RevisionFile.Type;
export const RevisionManifest = Schema.Struct({
  version: Schema.Literal(1), baseHead: Schema.String,
  scope: Schema.Struct({ included: Schema.String, excluded: Schema.Array(Schema.String), ignored: Schema.Array(Schema.String) }),
  base: Schema.Array(RevisionFile), index: Schema.Array(RevisionFile), files: Schema.Array(RevisionFile),
});
export type RevisionManifest = typeof RevisionManifest.Type;
export const WorkspaceCapture = Schema.Struct({
  workspace: Workspace, observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({ status: Schema.Literal("captured"), revision: Schema.String, physicalPath: Schema.String,
      branch: Schema.NullOr(Schema.String), manifest: RevisionManifest,
      stagedDiff: Schema.String, unstagedDiff: Schema.String, limitations: Schema.Array(Schema.String) }),
    Schema.Struct({ status: Schema.Literals(["error", "unsupported", "inconclusive"]), detail: Schema.String }),
  ]),
});
export type WorkspaceCapture = typeof WorkspaceCapture.Type;

// ── Sidebar views ───────────────────────────────────────────────────────────

export const SessionInfo = Schema.Struct({
  sessionId: Schema.String,
  workspaceId: Schema.String,
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

/** What picking a worktree needs, from Git; not exact revisions or verification evidence. */
export const WorktreeFacts = Schema.Struct({
  path: Schema.String, branch: Schema.NullOr(Schema.String), detached: Schema.Boolean,
  /** Git can prune it: the checkout directory is gone. */
  prunable: Schema.Boolean,
});
export type WorktreeFacts = typeof WorktreeFacts.Type;
export const WorktreeDiscovery = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ready"), observedAt: Schema.String, currentPath: Schema.String, worktrees: Schema.Array(WorktreeFacts) }),
  Schema.Struct({ status: Schema.Literal("non-git"), observedAt: Schema.String }),
  Schema.Struct({ status: Schema.Literal("error"), observedAt: Schema.String, detail: Schema.String }),
]);
export type WorktreeDiscovery = typeof WorktreeDiscovery.Type;
export const WorktreeView = Schema.Struct({
  workspace: Workspace,
  branch: Schema.NullOr(Schema.String), path: Schema.String,
  /** Registry project root, not necessarily Git's primary worktree. */
  root: Schema.Boolean,
  status: Schema.Literals(["current", "missing", "unknown", "non-git"]),
  facts: Schema.optional(WorktreeFacts),
});
export type WorktreeView = typeof WorktreeView.Type;

export const ProjectView = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  /** Explicitly selected directories only; discovery does not register anything. */
  worktrees: Schema.Array(WorktreeView),
  discovery: WorktreeDiscovery,
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
  cwd: Schema.String,
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

/** A GitHub pull request tied to a session: the worktree's branch, or a URL that appeared in the transcript. */
export const PullRequest = Schema.Struct({
  url: Schema.String,
  /** "owner/name" */
  repo: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.Literals(["open", "draft", "merged", "closed"]),
  checks: Schema.Literals(["none", "pending", "success", "failure"]),
  review: Schema.Literals(["none", "approved", "changes_requested", "review_required"]),
});
export type PullRequest = typeof PullRequest.Type;

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
  /** The cached catalog for `cwd`; `refresh` re-runs Pi's probe. */
  Schema.TaggedStruct("models", { cwd: Schema.optional(Schema.String), refresh: Schema.optional(Schema.Boolean) }),
  Schema.TaggedStruct("add_project", { path: Schema.String }),
  Schema.TaggedStruct("remove_project", { path: Schema.String }),
  Schema.TaggedStruct("create_worktree", { requestId: Schema.String, project: Schema.String, branch: Schema.String, hooks: Schema.Boolean }),
  Schema.TaggedStruct("add_worktree", { requestId: Schema.String, project: Schema.String, path: Schema.String }),
  Schema.TaggedStruct("select", { selectionId: Schema.String, cwd: Schema.String, sessionId: Schema.NullOr(Schema.String) }),
  /** Create and start a session in a directory (registering it as a project when needed) and send its first prompt. */
  Schema.TaggedStruct("create_session", { selectionId: Schema.String, cwd: Schema.String, options: StartOptions, text: Schema.optional(Schema.String), attachments: attachmentInput }),
  /** Act on the selected session. `start` carries the options used to start Pi when it is not running. */
  Schema.TaggedStruct("act", { selectionId: Schema.String, action: SessionAction, start: Schema.optional(StartOptions) }),
  Schema.TaggedStruct("ack", { deliveryId: Schema.Number }),
  /** Change the registry title shown for a session; Pi's history is untouched. */
  Schema.TaggedStruct("rename_session", { cwd: Schema.String, sessionId: Schema.String, title: Schema.String }),
  /** Hide a session from the sidebar (and stop Pi for it if running). */
  Schema.TaggedStruct("archive_session", { cwd: Schema.String, sessionId: Schema.String }),
  /** Stop Pi for a session, delete its file from Pi's session store, and forget it. */
  Schema.TaggedStruct("delete_session", { cwd: Schema.String, sessionId: Schema.String }),
]);
export type ClientMessage = typeof ClientMessage.Type;
/** UI intent; the connection's selection controller supplies correlation. */
export type ClientCommand = ClientMessage extends infer M ? M extends ClientMessage ? Omit<M, "selectionId"> : never : never;

export const WorktreeResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ready"), project: Schema.String, path: Schema.String, branch: Schema.NullOr(Schema.String),
    creation: Schema.optional(Schema.Struct({ baseBranch: Schema.String, hooks: Schema.Literals(["enabled", "skipped"]) })) }),
  Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
]);
export type WorktreeResult = typeof WorktreeResult.Type;

export const ServerMessage = Schema.Union([
  Schema.TaggedStruct("projects", { projects: Schema.Array(ProjectView) }),
  Schema.TaggedStruct("models", { catalog: ModelCatalog }),
  Schema.TaggedStruct("hosts", { hosts: Schema.Array(HostInfo) }),
  /** Result of `select`: the session now shown. `hosted` false means a read-only peek of the session file. */
  Schema.TaggedStruct("selected", {
    selectionId: Schema.String,
    cursor: Schema.NullOr(SessionCursor),
    cwd: Schema.String,
    sessionId: Schema.NullOr(Schema.String),
    hosted: Schema.Boolean,
    snapshot: Snapshot,
  }),
  Schema.TaggedStruct("session", { selectionId: Schema.String, cursor: SessionCursor, event: SessionEvent }),
  Schema.TaggedStruct("action_result", { cwd: Schema.String, sessionId: Schema.String, result: SessionActionResult }),
  Schema.TaggedStruct("worktree_result", { requestId: Schema.String, result: WorktreeResult }),
  Schema.TaggedStruct("error", { message: Schema.String }),
  /** A notice for the person; `level` picks the icon. */
  Schema.TaggedStruct("toast", { message: Schema.String, level: Schema.optional(Schema.Literals(["success", "info", "warning", "error"])) }),
]);
export type ServerMessage = typeof ServerMessage.Type;

export const ClientMessageJson = Schema.fromJsonString(ClientMessage);
export const ServerMessageJson = Schema.fromJsonString(ServerMessage);
export const decodeClientMessage = Schema.decodeUnknownSync(ClientMessageJson);
const decodePayload = Schema.decodeUnknownSync(ServerMessageJson);
const decodeDelivery = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ deliveryId: Schema.Number })));
export const encodeServerMessage = (message: ServerMessage, deliveryId: number) =>
  JSON.stringify({ ...JSON.parse(Schema.encodeSync(ServerMessageJson)(message)), deliveryId });
export const decodeServerMessage = (text: string): ServerMessage & { deliveryId: number } =>
  ({ ...decodePayload(text), ...decodeDelivery(text) });
export const encodeClientMessage = Schema.encodeSync(ClientMessageJson);
