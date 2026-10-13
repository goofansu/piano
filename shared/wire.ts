/**
 * Wire vocabulary shared by the server and the React client.
 *
 * SessionEvent / SessionAction are the native language of the PiSessions module:
 * a browser client consumes SessionEvents and produces SessionActions, and the
 * WebSocket layer is a pass-through. Everything is an effect Schema so both
 * sides decode with the same definitions.
 */
import { Schema, type Types } from "effect";
import {
  base64Bytes,
  IMAGE_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
} from "./attachments.ts";

/** Browser input, not a Pi protocol block. Future files get a distinct kind. */
export const Attachment = Schema.Struct({
  kind: Schema.Literal("image"),
  name: Schema.String.check(Schema.isMaxLength(255)),
  mimeType: Schema.Literals(IMAGE_TYPES),
  data: Schema.String.check(
    Schema.isMaxLength(4 * Math.ceil(MAX_IMAGE_BYTES / 3)),
    Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/),
  ),
}).check(
  Schema.makeFilter(
    (a) =>
      a.data.length % 4 === 0 && base64Bytes(a.data) > 0 && base64Bytes(a.data) <= MAX_IMAGE_BYTES,
  ),
);
export type Attachment = typeof Attachment.Type;
export const Attachments = Schema.Array(Attachment).check(
  Schema.isMaxLength(MAX_ATTACHMENTS),
  Schema.makeFilter(
    (items) => items.reduce((sum, a) => sum + base64Bytes(a.data), 0) <= MAX_ATTACHMENT_BYTES,
  ),
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
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  totalTokens: Schema.Number,
  cost: Schema.Number,
});
export type Usage = typeof Usage.Type;

/** One Subagent Run's spend as pi-subagent delivers it: no `totalTokens`, cost in unrounded USD. */
export const RunUsage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  cost: Schema.Number,
});
export type RunUsage = typeof RunUsage.Type;
const RunSpend = { usage: Schema.optional(RunUsage), model: Schema.optional(Schema.String) };
/** Delivered Runs' spend summed, with its token total and how many Runs it counts. */
const RunTotal = Schema.Struct({
  ...RunUsage.fields,
  totalTokens: Schema.Number,
  runs: Schema.Number,
});
export const ProfileUsage = Schema.Struct({
  ...RunTotal.fields,
  profile: Schema.String,
  /** Models the Profile's Runs reported; a Run without one adds nothing here. */
  models: Schema.Array(Schema.String),
  /** Every Run named a model, and all named the same one. */
  model: Schema.optional(Schema.String),
});
export type ProfileUsage = typeof ProfileUsage.Type;
export const SubagentUsage = Schema.Struct({
  /** In order of each Profile's first delivered Run, including Runs that spent nothing. */
  profiles: Schema.Array(ProfileUsage),
  total: RunTotal,
});
export type SubagentUsage = typeof SubagentUsage.Type;

const SubagentIdentity = {
  runId: Schema.optional(Schema.String),
  subagentId: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.String),
};
const TerminalSubagentStatus = Schema.Literals(["completed", "failed", "cancelled"]);
/** The card reports something left unresolved for the reader: a Run still running or unknown, a
 * result unavailable, a cancellation not yet settled, or Control refused for an unknown or
 * cancelled Run. Subagents derives it from the card's facts so readers never parse `status`. */
const attention = Schema.Boolean;

/** Validated presentation facts from pi-subagent. This is a historical projection,
 * not a live child registry: "Started" means last observed admission, never "Running".
 */
export const SubagentCard = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("delegation"),
    action: Schema.Literals(["start", "resume"]),
    ...SubagentIdentity,
    prompt: Schema.optional(Schema.String),
    /** As pi-subagent reported the call; the transcript settles its Run from later cards. */
    status: Schema.String,
    admitted: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("control"),
    action: Schema.Literal("steer"),
    ...SubagentIdentity,
    message: Schema.optional(Schema.String),
    status: Schema.String,
    attention,
  }),
  Schema.Struct({
    kind: Schema.Literal("collection"),
    scope: Schema.Literals(["named", "all-active"]),
    ...SubagentIdentity,
    status: Schema.String,
    terminalStatus: Schema.optional(TerminalSubagentStatus),
    runs: Schema.Array(
      Schema.Struct({
        ...SubagentIdentity,
        runId: Schema.String,
        profile: Schema.String,
        status: TerminalSubagentStatus,
        ...RunSpend,
      }),
    ),
    stillRunning: Schema.Number,
    unknown: Schema.Number,
    unavailable: Schema.Number,
    noActiveRuns: Schema.Boolean,
    attention,
  }),
  Schema.Struct({
    kind: Schema.Literal("result"),
    source: Schema.Literals(["tool", "notification"]),
    ...SubagentIdentity,
    status: Schema.String,
    terminalStatus: Schema.optional(TerminalSubagentStatus),
    durationMillis: Schema.optional(Schema.Number),
    ...RunSpend,
    attention,
  }),
  Schema.Struct({
    kind: Schema.Literal("cancellation"),
    status: Schema.String,
    outcomes: Schema.Array(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literals(["requested", "already requested", "unknown"]),
          runId: Schema.String,
        }),
        Schema.Struct({
          kind: Schema.Literal("already terminal"),
          runId: Schema.String,
          phase: TerminalSubagentStatus,
        }),
      ]),
    ),
    attention,
  }),
]);
export type SubagentCard = typeof SubagentCard.Type;

/** Execution preview, not a transcript message or an additional billable result. */
export const ToolExecution = Schema.Struct({
  id: Schema.String,
  parentId: Schema.optional(Schema.String),
  name: Schema.String,
  args: Schema.String,
  text: Schema.String,
  status: Schema.Literals(["running", "success", "error", "incomplete"]),
  outputKind: Schema.Literals(["latest-update", "final", "unavailable"]),
  subagent: Schema.optional(SubagentCard),
});
export type ToolExecution = typeof ToolExecution.Type;

export const ExtensionState = Schema.Struct({
  statuses: Schema.Array(Schema.Struct({ key: Schema.String, text: Schema.String })),
  widgets: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      lines: Schema.Array(Schema.String),
      placement: Schema.Literals(["aboveEditor", "belowEditor"]),
    }),
  ),
  title: Schema.optional(Schema.String),
  editorRequest: Schema.optional(Schema.Struct({ id: Schema.String, text: Schema.String })),
});
export type ExtensionState = typeof ExtensionState.Type;

export const RenderMsg = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "tool_result", "context"]),
  text: Schema.String,
  attachments: Schema.optional(
    Schema.Array(Schema.Struct({ kind: Schema.Literal("image"), url: Schema.String })),
  ),
  /** A `/skill:name` prompt as Pi expanded it. `text` is then only what the user typed after the command. */
  skill: Schema.optional(
    Schema.Struct({ name: Schema.String, location: Schema.String, body: Schema.String }),
  ),
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
  subagent: Schema.optional(SubagentCard),
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
  tokens: Schema.optional(
    Schema.Struct({
      input: Schema.Number,
      output: Schema.Number,
      cacheRead: Schema.Number,
      cacheWrite: Schema.Number,
      total: Schema.Number,
    }),
  ),
  statsUpdatedAt: Schema.Number,
});
export type SessionStats = typeof SessionStats.Type;

/** Why a session's Pi child stopped. Decide policy from the tag; `detail` is display text only. */
export const SessionClosure = Schema.Union([
  /** Released with nothing in flight: idle retirement, archive or shutdown of a settled session. */
  Schema.TaggedStruct("released", { detail: Schema.String }),
  /** Released while work was in flight. Interrupted operations are not resumed. */
  Schema.TaggedStruct("released_during_work", { detail: Schema.String }),
  /** Pi exited on its own. */
  Schema.TaggedStruct("exited", { code: Schema.Number, detail: Schema.String }),
  /** Pi's exit could not be observed. */
  Schema.TaggedStruct("failed", { detail: Schema.String }),
]);
export type SessionClosure = typeof SessionClosure.Type;

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
  /** Piano is returning queued input and cancelling the current run. */
  isStopping: Schema.optional(Schema.Boolean),
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
  /** Run usage delivered anywhere in the session file, compacted or on another branch, as Pi counts
   * its own totals; absent until a delivery carries usage. */
  subagents: Schema.optional(SubagentUsage),
  extension: Schema.optional(ExtensionState),
  projectionError: Schema.optional(Schema.String),
  stateRefreshError: Schema.optional(Schema.String),
  statsRefreshError: Schema.optional(Schema.String),
  /** Host observation used for retirement; no pending/unobserved work, not task success. */
  isQuiescent: Schema.optional(Schema.Boolean),
  /** Set once this child has stopped; the session is then history only. */
  closure: Schema.optional(SessionClosure),
  /** Piano filesystem observation: history is readable, but execution needs the checkout. */
  checkoutMissing: Schema.optional(Schema.Boolean),
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
  Schema.TaggedStruct("notice", {
    level: Schema.Literals(["info", "warning", "error"]),
    message: Schema.String,
  }),
  Schema.TaggedStruct("closed", { closure: SessionClosure }),
]);
export type SessionEvent = typeof SessionEvent.Type;

/** Ordered within one child incarnation, never a historical replay cursor. */
export const SessionCursor = Schema.Struct({
  cwd: Schema.String,
  sessionId: Schema.String,
  generation: Schema.String,
  sequence: Schema.Number,
});
export type SessionCursor = typeof SessionCursor.Type;
export type SessionFrame = SessionEvent & { readonly cursor: SessionCursor };

export const ThinkingLevel = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ThinkingLevel = typeof ThinkingLevel.Type;

export const SlashCommand = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  source: Schema.Literals(["extension", "prompt", "skill"]),
});
export type SlashCommand = typeof SlashCommand.Type;

/** Global provider sign-in; never part of a session transcript or registry. */
export const OAuthProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  signedIn: Schema.Boolean,
});
export type OAuthProvider = typeof OAuthProvider.Type;
export const LoginPrompt = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["text", "secret", "select", "manual_code"]),
  message: Schema.String,
  placeholder: Schema.optional(Schema.String),
  options: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        label: Schema.String,
        description: Schema.optional(Schema.String),
      }),
    ),
  ),
});
export type LoginPrompt = typeof LoginPrompt.Type;
export const ProviderLoginState = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  status: Schema.Literals(["running", "success", "error", "cancelled"]),
  message: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  userCode: Schema.optional(Schema.String),
  prompt: Schema.optional(LoginPrompt),
});
/** The server updates one attempt in place while it runs. */
export type ProviderLoginState = Types.Mutable<typeof ProviderLoginState.Type>;

/** Everything a browser client may do to a running session. */
export const SessionAction = Schema.Union([
  Schema.TaggedStruct("prompt", { text: Schema.String, attachments: attachmentInput }),
  Schema.TaggedStruct("steer", { text: Schema.String, attachments: attachmentInput }),
  Schema.TaggedStruct("abort", {}),
  Schema.TaggedStruct("stop", {}),
  Schema.TaggedStruct("restore_queue", {}),
  Schema.TaggedStruct("set_model", { model: Schema.String }),
  Schema.TaggedStruct("set_thinking_level", { level: ThinkingLevel }),
  /** Name the session in Pi's own history, as `/name` does. */
  Schema.TaggedStruct("set_name", { name: Schema.String }),
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
export const SessionActionResult = Schema.Union([
  Schema.TaggedStruct("queue_restored", {
    messages: Schema.Array(QueuedMessage),
    stopError: Schema.optional(Schema.String),
  }),
]);
export type SessionActionResult = typeof SessionActionResult.Type;

// ── Workspace captures ──────────────────────────────────────────────────────

export const Workspace = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  path: Schema.String,
});
export type Workspace = typeof Workspace.Type;
export const RevisionFile = Schema.Struct({
  path: Schema.String,
  mode: Schema.Literals(["100644", "100755", "120000"]),
  sha256: Schema.String,
  bytes: Schema.Number,
});
export type RevisionFile = typeof RevisionFile.Type;
export const RevisionManifest = Schema.Struct({
  version: Schema.Literal(1),
  baseHead: Schema.String,
  scope: Schema.Struct({
    included: Schema.String,
    excluded: Schema.Array(Schema.String),
    ignored: Schema.Array(Schema.String),
  }),
  base: Schema.Array(RevisionFile),
  index: Schema.Array(RevisionFile),
  files: Schema.Array(RevisionFile),
});
export type RevisionManifest = typeof RevisionManifest.Type;
export const WorkspaceCapture = Schema.Struct({
  workspace: Workspace,
  observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("captured"),
      revision: Schema.String,
      physicalPath: Schema.String,
      branch: Schema.NullOr(Schema.String),
      manifest: RevisionManifest,
      /** Base HEAD to captured working files, untracked included: what a reviewer reads as one list. */
      diff: Schema.String,
      stagedDiff: Schema.String,
      unstagedDiff: Schema.String,
      limitations: Schema.Array(Schema.String),
    }),
    Schema.Struct({
      status: Schema.Literals(["error", "unsupported", "inconclusive"]),
      detail: Schema.String,
    }),
  ]),
});
export type WorkspaceCapture = typeof WorkspaceCapture.Type;

/** Byte budgets for live Changes only; exact revision capture has separate limits. */
export const CHANGES_INITIAL_PATCH_BYTES = 120_000;
export const CHANGES_FILE_PATCH_BYTES = 1024 * 1024;

/** Live Git observations, not immutable revisions or verification evidence. */
export const ChangeFile = Schema.Struct({
  path: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  binary: Schema.Boolean,
});
export type ChangeFile = typeof ChangeFile.Type;
export const WorkspaceChanges = Schema.Struct({
  workspace: Workspace,
  observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("ready"),
      head: Schema.NullOr(Schema.String),
      branch: Schema.NullOr(Schema.String),
      files: Schema.Array(ChangeFile),
      diff: Schema.String,
      truncated: Schema.Boolean,
    }),
    Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
  ]),
});
export type WorkspaceChanges = typeof WorkspaceChanges.Type;

// ── Sidebar views ───────────────────────────────────────────────────────────

export const Project = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  archived: Schema.Boolean,
});
export type Project = typeof Project.Type;
/**
 * One registered session: the sidebar's, palette's and router's only session list. Running state
 * travels separately in `hosts`.
 */
export const SessionReference = Schema.Struct({
  cwd: Schema.String,
  sessionId: Schema.String,
  title: Schema.optional(Schema.String),
  /** Registry identity of the session's directory (INV-07). */
  workspaceId: Schema.String,
  /** Git's branch for that directory from the last discovery; null when unknown, detached, non-Git or its folder is closed. */
  branch: Schema.NullOr(Schema.String),
  projectId: Schema.optional(Schema.String),
  archived: Schema.Boolean,
  pinned: Schema.optional(Schema.Boolean),
  createdAt: Schema.String,
  /** Registry's last-update time, so a project's recency follows its members. */
  updatedAt: Schema.String,
  unavailable: Schema.optional(Schema.Literals(["history", "checkout"])),
});
export type SessionReference = typeof SessionReference.Type;

/** What picking a worktree needs, from Git; not exact revisions or verification evidence. */
export const WorktreeFacts = Schema.Struct({
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  detached: Schema.Boolean,
  /** Git can prune it: the checkout directory is gone. */
  prunable: Schema.Boolean,
});
export type WorktreeFacts = typeof WorktreeFacts.Type;
export const WorktreeDiscovery = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ready"),
    observedAt: Schema.String,
    currentPath: Schema.String,
    worktrees: Schema.Array(WorktreeFacts),
  }),
  Schema.Struct({ status: Schema.Literal("non-git"), observedAt: Schema.String }),
  Schema.Struct({
    status: Schema.Literal("error"),
    observedAt: Schema.String,
    detail: Schema.String,
  }),
]);
export type WorktreeDiscovery = typeof WorktreeDiscovery.Type;
/** Pi's project-trust outcome for a directory. `required` is false when it holds no protected resources. */
export const ProjectTrust = Schema.Struct({
  required: Schema.Boolean,
  /** Whether a Pi started here loads the directory's `.pi` settings, extensions and skills. */
  trusted: Schema.Boolean,
});
export type ProjectTrust = typeof ProjectTrust.Type;
export const WorktreeView = Schema.Struct({
  workspace: Workspace,
  trust: ProjectTrust,
  branch: Schema.NullOr(Schema.String),
  path: Schema.String,
  /** Registry folder root, not necessarily Git's primary worktree. */
  root: Schema.Boolean,
  status: Schema.Literals(["current", "missing", "unknown", "non-git"]),
  facts: Schema.optional(WorktreeFacts),
});
export type WorktreeView = typeof WorktreeView.Type;

export const FolderView = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  /** Explicitly selected directories only; discovery does not register anything. */
  worktrees: Schema.Array(WorktreeView),
  discovery: WorktreeDiscovery,
});
export type FolderView = typeof FolderView.Type;

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
  /** Preliminary cwd resources; a live session's commands take precedence. */
  commands: Schema.optional(Schema.Array(SlashCommand)),
  defaultModel: Schema.optional(Schema.String),
  defaultThinkingLevel: Schema.optional(Schema.String),
  fetchedAt: Schema.String,
  error: Schema.optional(Schema.String),
});
export type ModelCatalog = typeof ModelCatalog.Type;

/** Machine-wide Pi defaults, not a folder's resolved startup selection. */
export const SessionDefaults = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: ThinkingLevel,
});
export type SessionDefaults = typeof SessionDefaults.Type;

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

/** Live GitHub facts, separate from the session's durable PR association. */
export const PullRequest = Schema.Struct({
  url: Schema.String,
  /** "owner/name" */
  repo: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.Literals(["open", "draft", "merged", "closed"]),
  checks: Schema.Literals(["none", "pending", "success", "failure"]),
  review: Schema.Literals(["none", "approved", "changes_requested", "review_required"]),
  author: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
  /** Close or merge time once disposed, otherwise last update (ISO). */
  at: Schema.optional(Schema.String),
});
export type PullRequest = typeof PullRequest.Type;

export const SessionPullRequestLink = Schema.Struct({
  url: Schema.String,
  source: Schema.Literals(["branch", "manual"]),
  /** Authentication route, not the browser URL. Retained when the checkout disappears. */
  apiHost: Schema.optional(Schema.Literal("github.int.exe.xyz")),
});
export type SessionPullRequestLink = typeof SessionPullRequestLink.Type;

export const SessionPullRequest = Schema.Struct({
  link: Schema.NullOr(SessionPullRequestLink),
  pullRequest: Schema.NullOr(PullRequest),
  /** Removal disables discovery until explicitly requested again. */
  discovery: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
export type SessionPullRequest = typeof SessionPullRequest.Type;
export const SessionPullRequestAction = Schema.Union([
  Schema.Struct({ action: Schema.Literal("link"), url: Schema.String }),
  Schema.Struct({ action: Schema.Literal("remove") }),
  Schema.Struct({ action: Schema.Literal("discover") }),
]);
export type SessionPullRequestAction = typeof SessionPullRequestAction.Type;

export const HostInfo = Schema.Struct({
  cwd: Schema.String,
  sessionId: Schema.String,
  streaming: Schema.Boolean,
});
export type HostInfo = typeof HostInfo.Type;

// ── WebSocket protocol ──────────────────────────────────────────────────────

export const StartOptions = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(ThinkingLevel),
  name: Schema.optional(Schema.String),
});
export type StartOptions = typeof StartOptions.Type;

export const ClientMessage = Schema.Union([
  Schema.TaggedStruct("registry", {}),
  /** Rediscover one registered folder's worktrees; only the requesting client gets the answer. */
  Schema.TaggedStruct("worktrees", { folder: Schema.String }),
  /** The cached catalog for `cwd`; `refresh` re-runs Pi's probe. */
  Schema.TaggedStruct("models", { cwd: Schema.String, refresh: Schema.optional(Schema.Boolean) }),
  /** Create or rename a project; with `assign`, that session joins it in the same registry write. */
  Schema.TaggedStruct("save_project", {
    project: Schema.Struct({ id: Project.fields.id, name: Project.fields.name }),
    assign: Schema.optional(Schema.Struct({ cwd: Schema.String, sessionId: Schema.String })),
  }),
  Schema.TaggedStruct("archive_project", { id: Schema.String, archived: Schema.Boolean }),
  Schema.TaggedStruct("assign_project", {
    cwd: Schema.String,
    sessionId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("add_folder", { path: Schema.String }),
  Schema.TaggedStruct("remove_folder", { path: Schema.String }),
  /** Save Pi's project-trust decision for a directory; Pi applies it when a session starts there. */
  Schema.TaggedStruct("set_trust", { path: Schema.String, trusted: Schema.Boolean }),
  /** Pi's trust outcome for any directory, registered or not. */
  Schema.TaggedStruct("trust", { cwd: Schema.String }),
  Schema.TaggedStruct("create_worktree", {
    requestId: Schema.String,
    folder: Schema.String,
    branch: Schema.String,
    hooks: Schema.Boolean,
  }),
  Schema.TaggedStruct("add_worktree", {
    requestId: Schema.String,
    folder: Schema.String,
    path: Schema.String,
  }),
  Schema.TaggedStruct("select", {
    selectionId: Schema.String,
    cwd: Schema.String,
    sessionId: Schema.NullOr(Schema.String),
  }),
  /** Create and start a session in a directory (registering it as a folder when needed) and send its first prompt. */
  Schema.TaggedStruct("create_session", {
    selectionId: Schema.String,
    cwd: Schema.String,
    projectId: Schema.optional(Schema.String),
    options: StartOptions,
    text: Schema.optional(Schema.String),
    attachments: attachmentInput,
  }),
  /** Act on the selected session. `start` starts a stopped Pi, or applies draft model/effort choices before acting on a running Pi. */
  Schema.TaggedStruct("act", {
    selectionId: Schema.String,
    action: SessionAction,
    start: Schema.optional(StartOptions),
  }),
  /** Round-trip liveness, independent of incoming session activity. */
  Schema.TaggedStruct("ping", { nonce: Schema.String }),
  Schema.TaggedStruct("ack", { deliveryId: Schema.Number }),
  /** Name a session through Pi (starting it when not running); the registry title follows Pi's name. */
  Schema.TaggedStruct("rename_session", {
    cwd: Schema.String,
    sessionId: Schema.String,
    title: Schema.String,
  }),
  /** Set a sidebar preference without starting or stopping Pi. */
  Schema.TaggedStruct("pin_session", {
    cwd: Schema.String,
    sessionId: Schema.String,
    pinned: Schema.Boolean,
  }),
  /** Hide a session from the sidebar (and stop Pi for it if running). */
  Schema.TaggedStruct("archive_session", { cwd: Schema.String, sessionId: Schema.String }),
  /** Stop Pi for a session, delete its file from Pi's session store, and forget it. */
  Schema.TaggedStruct("delete_session", { cwd: Schema.String, sessionId: Schema.String }),
]);
export type ClientMessage = typeof ClientMessage.Type;
/** UI intent; the connection's selection controller supplies correlation. */
export type ClientCommand = ClientMessage extends infer M
  ? M extends ClientMessage
    ? Omit<M, "selectionId">
    : never
  : never;

export const WorktreeResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ready"),
    folder: Schema.String,
    path: Schema.String,
    branch: Schema.NullOr(Schema.String),
    creation: Schema.optional(
      Schema.Struct({ baseBranch: Schema.String, hooks: Schema.Literals(["enabled", "skipped"]) }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    detail: Schema.String,
    /** The operation may have changed a checkout; the browser asks for rediscovery. */
    unconfirmed: Schema.optional(Schema.Boolean),
  }),
]);
export type WorktreeResult = typeof WorktreeResult.Type;

export const ServerMessage = Schema.Union([
  Schema.TaggedStruct("pong", { nonce: Schema.String }),
  Schema.TaggedStruct("registry", {
    folders: Schema.Array(FolderView),
    projects: Schema.optional(Schema.Array(Project)),
    sessionReferences: Schema.optional(Schema.Array(SessionReference)),
    workspaces: Schema.optional(Schema.Array(Workspace)),
  }),
  Schema.TaggedStruct("models", { catalog: ModelCatalog }),
  Schema.TaggedStruct("catalogs_invalidated", {}),
  Schema.TaggedStruct("worktrees", { folder: Schema.String, discovery: WorktreeDiscovery }),
  Schema.TaggedStruct("trust", { cwd: Schema.String, trust: ProjectTrust }),
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
  Schema.TaggedStruct("session", {
    selectionId: Schema.String,
    cursor: SessionCursor,
    event: SessionEvent,
  }),
  Schema.TaggedStruct("action_result", {
    cwd: Schema.String,
    sessionId: Schema.String,
    result: SessionActionResult,
  }),
  Schema.TaggedStruct("worktree_result", { requestId: Schema.String, result: WorktreeResult }),
  /** Admission refused before selection or session creation started. */
  Schema.TaggedStruct("selection_rejected", {
    selectionId: Schema.String,
    message: Schema.String,
  }),
  /** An admitted attachment failed. Makes no claim about prior creation or message delivery. */
  Schema.TaggedStruct("selection_failed", {
    selectionId: Schema.String,
    message: Schema.String,
  }),
  Schema.TaggedStruct("error", {
    message: Schema.String,
    selectionId: Schema.optional(Schema.String),
  }),
  /** A notice for the person; `level` picks the icon. */
  Schema.TaggedStruct("toast", {
    message: Schema.String,
    level: Schema.optional(Schema.Literals(["success", "info", "warning", "error"])),
  }),
]);
export type ServerMessage = typeof ServerMessage.Type;

export const ClientMessageJson = Schema.fromJsonString(ClientMessage);
export const ServerMessageJson = Schema.fromJsonString(ServerMessage);
export const decodeClientMessage = Schema.decodeUnknownSync(ClientMessageJson);
const decodePayload = Schema.decodeUnknownSync(ServerMessageJson);
const decodeDelivery = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ deliveryId: Schema.Number })),
);
export const encodeServerMessage = (message: ServerMessage, deliveryId: number) =>
  JSON.stringify({ ...JSON.parse(Schema.encodeSync(ServerMessageJson)(message)), deliveryId });
export const decodeServerMessage = (text: string): ServerMessage & { deliveryId: number } => ({
  ...decodePayload(text),
  ...decodeDelivery(text),
});
export const encodeClientMessage = Schema.encodeSync(ClientMessageJson);
