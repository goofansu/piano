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
import { DISPOSITIONS } from "./dispatch.ts";

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
  /** Supported write/edit target, extracted before display redaction. Not proof of success. */
  writtenPath: Schema.optional(Schema.String),
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

/** Execution preview, not a transcript message or an additional billable result. */
export const ToolExecution = Schema.Struct({
  id: Schema.String,
  parentId: Schema.optional(Schema.String),
  name: Schema.String,
  args: Schema.String,
  writtenPath: Schema.optional(Schema.String),
  text: Schema.String,
  status: Schema.Literals(["running", "success", "error", "incomplete"]),
  outputKind: Schema.Literals(["latest-update", "final", "unavailable"]),
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
  /** Process-keyed equality evidence for recorded text input, never a hash of display text. */
  inputFingerprint: Schema.optional(Schema.String),
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
});
export type RenderMsg = typeof RenderMsg.Type;

export const Dialog = Schema.Struct({
  id: Schema.String,
  /** One RPC child incarnation; old tabs cannot answer a restarted child's dialog. */
  generation: Schema.String,
  receivedAt: Schema.Number,
  timeoutMs: Schema.optional(Schema.Number),
  /** The running tool call that raised this dialog, when Piano can tell (Piano's own `ask_user`):
   * Pi's native end record for that call closes the dialog and its stored result confirms the
   * answer, so no deadline is estimated. Other dialogs get a host estimate (`deadlineAt`). */
  toolCallId: Schema.optional(Schema.String),
  /** The `ask_user` question this owned dialog asks: its stored answer is looked up by this ID. */
  questionId: Schema.optional(Schema.String),
  /** Null when a tool call owns the dialog: it closes with that call, never on a timer. */
  deadlineAt: Schema.NullOr(Schema.Number),
  deadlineKind: Schema.Literals(["pi-timeout", "host-recovery", "tool-end"]),
  method: Schema.Literals(["select", "confirm", "input", "editor"]),
  title: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Schema.String)),
  placeholder: Schema.optional(Schema.String),
  prefill: Schema.optional(Schema.String),
});
export type Dialog = typeof Dialog.Type;

/** A local claim plus delivery. `accepted` and `rejected` come only from the owning tool call's
 * stored result; `written` is a completed stdin write, never proof Pi consumed the response. */
export const DialogResolution = Schema.Struct({
  id: Schema.String,
  generation: Schema.String,
  reason: Schema.Literals(["answered", "cancelled", "expired", "aborted", "recovery", "exited"]),
  /** The tool call that owned the dialog: its end will confirm or reject a written response. */
  toolCallId: Schema.optional(Schema.String),
  /** The owned dialog's `ask_user` question, whose stored answer confirms the written one. */
  questionId: Schema.optional(Schema.String),
  delivery: Schema.Literals([
    "pending",
    "written",
    "accepted",
    "rejected",
    "uncertain",
    "not-sent",
  ]),
  detail: Schema.String,
  /** The submitted reply, retained only with this live receipt, not as Pi history. */
  answer: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      value: Schema.Union([Schema.String, Schema.Boolean]),
    }),
  ),
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
  /** Caller correlation only, never a retry/deduplication key. */
  inputId: Schema.optional(Schema.String),
  /** Same server-owned equality token as recorded input, before Pi transforms or redacts it. */
  inputFingerprint: Schema.optional(Schema.String),
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
  /** Released while work was in flight, unasked (shutdown, replacement). Interrupted operations
   * are not resumed. */
  Schema.TaggedStruct("released_during_work", { detail: Schema.String }),
  /** Stopped at the person's request (archive or delete) while work was in flight. Interrupted
   * operations are not resumed. */
  Schema.TaggedStruct("stopped", { detail: Schema.String }),
  /** Pi exited on its own. */
  Schema.TaggedStruct("exited", { code: Schema.Number, detail: Schema.String }),
  /** Pi's exit could not be observed. */
  Schema.TaggedStruct("failed", { detail: Schema.String }),
]);
export type SessionClosure = typeof SessionClosure.Type;

/** States a managed app's supervisor reports, in the same words on launchd and systemd. */
export const PREVIEW_STATES = [
  "starting",
  "running",
  "exited",
  "failed",
  "stopping",
  "not-loaded",
] as const;

/**
 * This session's managed app as its live Pi generation last observed it (ADR 0003). An app never
 * outlives that generation, so a saved or closed session has none. `unknown`: the supervisor
 * could not be read, which is neither running nor stopped. Re-observe before relying on it.
 */
export const SessionPreview = Schema.Struct({
  /** Exact instance identity; a stop names it, so it can never stop a replacement. */
  instanceId: Schema.String,
  state: Schema.Literals([...PREVIEW_STATES, "unknown"]),
  /** Local HTTP readiness through the preview hostname, not authenticated external access. */
  ready: Schema.Boolean,
  /** Present only while ready. */
  url: Schema.NullOr(Schema.String),
  port: Schema.Number,
  command: Schema.Array(Schema.String),
  /** The last readiness or observation outcome, as display text. */
  detail: Schema.String,
  /** A loopback origin opens on this host; a private exe.dev origin is not checked from here. */
  externalAccess: Schema.Literals(["same-host", "unverified"]),
  /** Epoch seconds. */
  observedAt: Schema.Number,
});
export type SessionPreview = typeof SessionPreview.Type;

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
  /** The session that dispatched this one, as recorded in its Pi history; absent when not dispatched. */
  dispatchedFrom: Schema.optional(Schema.String),
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
  /** The app this live generation owns, if it has started one and not stopped it. */
  preview: Schema.optional(SessionPreview),
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
  /** Live successful response completion; never reconstructed from history or a snapshot. */
  Schema.TaggedStruct("response_completed", {}),
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
  Schema.TaggedStruct("prompt", {
    text: Schema.String,
    attachments: attachmentInput,
    inputId: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("steer", {
    text: Schema.String,
    attachments: attachmentInput,
    inputId: Schema.optional(Schema.String),
  }),
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
  /** Re-observe this generation's app without starting Pi or launching anything. */
  Schema.TaggedStruct("preview_status", {}),
  /** Stop exactly this instance of this generation's app; Pi stays available. */
  Schema.TaggedStruct("preview_stop", { instanceId: Schema.String }),
]);
export type SessionAction = typeof SessionAction.Type;

/** A command result for its caller, not a broadcast session event. */
export const SessionActionResult = Schema.Union([
  Schema.TaggedStruct("queue_restored", {
    messages: Schema.Array(QueuedMessage),
    stopError: Schema.optional(Schema.String),
  }),
  /** Bounded, redacted logs of the app the observation found; empty when it found none. A failed
   * observation is `error`, never an absent app: the state then shows the preview as unknown. */
  Schema.TaggedStruct("preview_observed", {
    instanceId: Schema.NullOr(Schema.String),
    logs: Schema.String,
    error: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("preview_stopped", {
    instanceId: Schema.String,
    /** `not-current`: that instance was already gone or replaced; nothing was stopped. */
    outcome: Schema.Literals(["stopped", "cleared", "not-current"]),
  }),
]);
export type SessionActionResult = typeof SessionActionResult.Type;

// ── Workspaces ──────────────────────────────────────────────────────────────

export const Workspace = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  path: Schema.String,
});
export type Workspace = typeof Workspace.Type;

/** Byte budgets for live Changes. */
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
/**
 * What Changes compares the working tree with, named by the question it answers: `branch`, the
 * merge-base with the branch's target (what does this branch propose?); `uncommitted`, HEAD (what
 * is not committed yet?).
 */
export const ChangesScope = Schema.Literals(["branch", "uncommitted"]);
export type ChangesScope = typeof ChangesScope.Type;
/** The `branch` scope's target and where Piano got it, each labelled for the user. */
export const ComparisonTarget = Schema.Struct({
  /** The branch's short name, as the status shows it. */
  name: Schema.String,
  /** The full ref the comparison read. */
  ref: Schema.String,
  commit: Schema.String,
  /** The pull request's base, the base Worktrunk reported at creation, the remote's default
   * branch as Git holds it locally, or a local `main`/`master` assumed. */
  from: Schema.Literals(["pull-request", "worktree", "remote-default", "assumed"]),
});
export type ComparisonTarget = typeof ComparisonTarget.Type;
/** The comparison an observation was read with; a later per-file read must name the same. */
export const Comparison = Schema.Struct({
  scope: ChangesScope,
  /** The commit (or the empty tree) the working tree is compared with. */
  base: Schema.String,
  target: Schema.optional(ComparisonTarget),
});
export type Comparison = typeof Comparison.Type;
/** Whether a scope can be read for the checkout now, and why not. */
export const ScopeAvailability = Schema.Struct({
  scope: ChangesScope,
  available: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  /** The resolved target, even when the comparison is unavailable (for example, on the base itself). */
  target: Schema.optional(ComparisonTarget),
});
export type ScopeAvailability = typeof ScopeAvailability.Type;
/** What of the checkout's work is still only local, whatever the scope on screen. */
export const LocalWork = Schema.Struct({
  /** Commits the branch's remote-tracking ref lacks (its upstream, else its own name on the remote), as Git holds it; null without that ref. */
  commitsNotPushed: Schema.NullOr(Schema.Number),
  /** The working tree differs from HEAD, untracked non-ignored files included. */
  uncommitted: Schema.Boolean,
});
export type LocalWork = typeof LocalWork.Type;
export const WorkspaceChanges = Schema.Struct({
  workspace: Workspace,
  observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("ready"),
      head: Schema.NullOr(Schema.String),
      branch: Schema.NullOr(Schema.String),
      /** The session's linked pull request was opened from this branch: its head names the
       * branch, by its name on its remote, in that remote's repository. */
      pullRequestFromBranch: Schema.Boolean,
      comparison: Comparison,
      scopes: Schema.Array(ScopeAvailability),
      local: LocalWork,
      files: Schema.Array(ChangeFile),
      diff: Schema.String,
      truncated: Schema.Boolean,
    }),
    /** The asked-for scope cannot be read for this checkout; the others may be. Never a quiet
     * fallback to another comparison (INV-06). */
    Schema.Struct({
      status: Schema.Literal("unavailable"),
      head: Schema.NullOr(Schema.String),
      branch: Schema.NullOr(Schema.String),
      pullRequestFromBranch: Schema.Boolean,
      scope: ChangesScope,
      detail: Schema.String,
      scopes: Schema.Array(ScopeAvailability),
      local: LocalWork,
    }),
    Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
  ]),
});
export type WorkspaceChanges = typeof WorkspaceChanges.Type;

/**
 * Where one path a session wrote stands, as sent: `outside` the workspace, or inside it and placed
 * at `placed` (its name relative to the workspace root, so spellings of one file are known to be
 * one), where Git ignores it, it no longer exists (a later command removed it), or it is `listed`
 * in the Files list. Git's verdict comes first: an ignored path is `ignored` whether or not it exists.
 */
export const WrittenFile = Schema.Union([
  Schema.Struct({ path: Schema.String, verdict: Schema.Literal("outside") }),
  Schema.Struct({
    path: Schema.String,
    verdict: Schema.Literals(["listed", "ignored", "missing"]),
    placed: Schema.String,
  }),
]);
export type WrittenFile = typeof WrittenFile.Type;

/** One `WrittenFile` per path asked about, in the order they were sent. */
export const WorkspaceWrittenFiles = Schema.Struct({
  workspace: Workspace,
  observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({ status: Schema.Literal("ready"), files: Schema.Array(WrittenFile) }),
    Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
  ]),
});
export type WorkspaceWrittenFiles = typeof WorkspaceWrittenFiles.Type;

/** Whether two observations name one workspace, by all of its identity (INV-07). */
export const sameWorkspace = (a: Workspace, b: Workspace) =>
  a.id === b.id && a.path === b.path && a.folder === b.folder;

// ── Sidebar views ───────────────────────────────────────────────────────────

/**
 * Limits on text the registry saves trimmed, in UTF-16 code units as the browser counts them,
 * counted as saved: a value fits when its trimmed length does.
 */
const trimmedFit = (max: number) => Schema.makeFilter((t: string) => t.trim().length <= max);
export const PROJECT_NAME_MAX = 200;
export const SESSION_TITLE_MAX = 200;
const sessionTitleFit = trimmedFit(SESSION_TITLE_MAX);
export const PROJECT_INSTRUCTIONS_MAX = 20_000;
export const ProjectInstructions = Schema.String.check(
  Schema.isMinLength(1),
  trimmedFit(PROJECT_INSTRUCTIONS_MAX),
);
export const Project = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String.check(Schema.isMinLength(1), trimmedFit(PROJECT_NAME_MAX)),
  /** Added to Pi's system prompt for the project's sessions whenever Piano starts their Pi. */
  instructions: Schema.optional(ProjectInstructions),
});
export type Project = typeof Project.Type;
/** A session's pull request as the registry saves it; GitHub owns the facts behind it. */
export const SessionPullRequestLink = Schema.Struct({
  url: Schema.String,
  source: Schema.Literals(["branch", "manual"]),
  /** Authentication route, not the browser URL. Retained when the checkout disappears. */
  apiHost: Schema.optional(Schema.Literal("github.int.exe.xyz")),
  /** Branch identities as GitHub last reported them. Legacy links without repository
   * identities remain associations, but cannot choose a Changes target until refreshed. */
  head: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  headRepo: Schema.optional(Schema.String),
  baseRepo: Schema.optional(Schema.String),
});
export type SessionPullRequestLink = typeof SessionPullRequestLink.Type;
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
  /** The registry's pull request link: absent until discovered, null once removed. Its live
   * facts are read only for a linked session, so unlinked ones cost no GitHub call. */
  pullRequest: Schema.optional(Schema.NullOr(SessionPullRequestLink)),
  /** Git's branch for that directory from the last discovery. Once Git no longer lists a registered
   * worktree (removed, or its folder closed), the last branch Git reported for that worktree; null
   * when neither is known (a failed or not-yet-run discovery is unknown, not a removal), or when Git
   * lists the directory as detached or non-Git. */
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

/** A session's identity is its exact `cwd` string and `sessionId`; every key and comparison uses these. */
export const sessionKey = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
export const sameSession = (
  a: { readonly cwd: string; readonly sessionId: string },
  b: { readonly cwd: string; readonly sessionId: string },
) => a.cwd === b.cwd && a.sessionId === b.sessionId;

/** Checkout facts from Git discovery; not verification evidence. */
export const WorktreeFacts = Schema.Struct({
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  detached: Schema.Boolean,
  /** Checked-out commit, absent for an unborn HEAD. */
  head: Schema.optional(Schema.String),
  /** Git can prune it: the checkout directory is gone. */
  prunable: Schema.Boolean,
});
export type WorktreeFacts = typeof WorktreeFacts.Type;
export const WorktreeDiscovery = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ready"),
    observedAt: Schema.String,
    currentPath: Schema.String,
    /** GitHub owner/repo from origin, shared by this folder’s worktrees; never a raw remote URL. */
    githubRepo: Schema.optional(Schema.String),
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
  /** Lower-case GitHub "owner/name"; the head can belong to a fork of `baseRepo`. */
  headRepo: Schema.optional(Schema.String),
  baseRepo: Schema.optional(Schema.String),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
  /** Close or merge time once disposed, otherwise last update (ISO). */
  at: Schema.optional(Schema.String),
});
export type PullRequest = typeof PullRequest.Type;

export const SessionPullRequest = Schema.Struct({
  link: Schema.NullOr(SessionPullRequestLink),
  pullRequest: Schema.NullOr(PullRequest),
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
  /** `workUnderWay` of the host's state: the session is working. */
  working: Schema.Boolean,
  /** This generation owns an app that may still be running; ending Pi stops it. */
  preview: Schema.optional(Schema.Boolean),
});
export type HostInfo = typeof HostInfo.Type;

// ── WebSocket protocol ──────────────────────────────────────────────────────

export const StartOptions = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(ThinkingLevel),
  name: Schema.optional(Schema.String.check(sessionTitleFit)),
  /** The session whose dispatch tool created this one; recorded in the new session's own history. */
  dispatchedFrom: Schema.optional(Schema.String),
});
export type StartOptions = typeof StartOptions.Type;

/** A new worktree to create for a new session; see shared/dispatch.ts WorktreeRequest. */
export const WorktreeRequest = Schema.Struct({
  branch: Schema.String,
  hooks: Schema.optional(Schema.Boolean),
});
export type WorktreeRequest = typeof WorktreeRequest.Type;
/** How long Piano gives Worktrunk to create a worktree, approved hooks included. A start that
 * asks for a worktree waits this much longer for its answer, so a creation Piano allows is one
 * the start observes rather than gives up on. */
export const WORKTREE_CREATION_MS = 60_000;

/** One session's status as the server reads it; the caller adds the links it knows how to build. */
export const SessionStatusFacts = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  disposition: Schema.Literals(DISPOSITIONS),
  /** ISO time the disposition is dated from: the dialog's arrival, else the last recorded activity. */
  since: Schema.NullOr(Schema.String),
  /** Present exactly when `disposition` is "needs_input": the dialog's title and the answer kind. */
  needs: Schema.NullOr(Schema.Struct({ title: Schema.String, kind: Schema.String })),
  /** The final assistant text of the last turn, at most LAST_ANSWER_CHARS, or null. */
  lastAnswer: Schema.NullOr(Schema.String),
  /** Null when the directory is not a Git checkout Piano can read. */
  changes: Schema.NullOr(
    Schema.Struct({
      branch: Schema.NullOr(Schema.String),
      files: Schema.Number,
      /** The session's linked pull request; `state` is null when GitHub could not be read. */
      pullRequest: Schema.NullOr(
        Schema.Struct({
          number: Schema.Number,
          url: Schema.String,
          state: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  ),
});
export type SessionStatusFacts = typeof SessionStatusFacts.Type;

export const ClientMessage = Schema.Union([
  Schema.TaggedStruct("registry", {}),
  /** Rediscover one registered folder; echo requestId so replies survive picker remounts. */
  Schema.TaggedStruct("worktrees", {
    folder: Schema.String,
    requestId: Schema.optional(Schema.String),
  }),
  /** The cached catalog for `cwd`; explicit refreshes use `requestId` for terminal replies. */
  Schema.TaggedStruct("models", {
    cwd: Schema.String,
    refresh: Schema.optional(Schema.Boolean),
    requestId: Schema.optional(Schema.String),
  }),
  /**
   * Create a project, with its instructions when given; with `assign`, that session joins it in
   * the same registry write.
   */
  Schema.TaggedStruct("save_project", {
    project: Schema.Struct({
      id: Project.fields.id,
      name: Project.fields.name,
      instructions: Schema.optional(ProjectInstructions),
    }),
    assign: Schema.optional(Schema.Struct({ cwd: Schema.String, sessionId: Schema.String })),
  }),
  /** Delete a project; its sessions stay and move to No project. */
  Schema.TaggedStruct("delete_project", { id: Schema.String }),
  /**
   * Change a known project's name or instructions in one registry write, answered with a toast.
   * Null instructions clear them; an unknown project is refused, never recreated.
   */
  Schema.TaggedStruct("update_project", {
    id: Schema.String,
    name: Schema.optional(Project.fields.name),
    instructions: Schema.optional(Schema.NullOr(ProjectInstructions)),
  }),
  Schema.TaggedStruct("assign_project", {
    cwd: Schema.String,
    sessionId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
  }),
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
  /** Show a session. */
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
    /** Create this new worktree from `cwd`'s repository and start the session there instead. */
    worktree: Schema.optional(WorktreeRequest),
    text: Schema.optional(Schema.String),
    attachments: attachmentInput,
  }),
  /** Read sessions' status without starting Pi: one by ID, or every active session of a project. */
  Schema.TaggedStruct("session_status", {
    requestId: Schema.String,
    target: Schema.Union([
      Schema.Struct({ sessionId: Schema.String }),
      Schema.Struct({ projectId: Schema.String }),
    ]),
  }),
  /**
   * Act on the selected session. Reuse the selectionId from the current select or create_session
   * on this connection (echoed by selected); it is a selection claim, not a per-action request id.
   * A different id is refused as stale even when the same session is still hosted.
   * `start: {}` restarts a stopped Pi; start options also apply draft model/effort choices to a running Pi.
   */
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
    title: Schema.String.check(sessionTitleFit),
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
  /** With a request ID, catalog.cwd echoes the requested directory spelling. */
  Schema.TaggedStruct("models", {
    catalog: ModelCatalog,
    requestId: Schema.optional(Schema.String),
  }),
  /** Terminal refusal or failure; never replaces a last good catalog. */
  Schema.TaggedStruct("models_failed", {
    cwd: Schema.String,
    requestId: Schema.optional(Schema.String),
    message: Schema.String,
  }),
  Schema.TaggedStruct("catalogs_invalidated", {}),
  Schema.TaggedStruct("worktrees", {
    folder: Schema.String,
    requestId: Schema.optional(Schema.String),
    discovery: WorktreeDiscovery,
  }),
  Schema.TaggedStruct("trust", {
    cwd: Schema.String,
    trust: ProjectTrust,
    /** Present only on a completed set_trust reply, even when Pi overrode the requested value. */
    requested: Schema.optional(Schema.Boolean),
  }),
  /** A set_trust that ended without its `trust` reply, for the path the request named. */
  Schema.TaggedStruct("trust_failed", { cwd: Schema.String, message: Schema.String }),
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
  Schema.TaggedStruct("session_status", {
    requestId: Schema.String,
    result: Schema.Union([
      Schema.Struct({
        status: Schema.Literal("ready"),
        sessions: Schema.Array(SessionStatusFacts),
      }),
      Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
    ]),
  }),
  /** Admission refused, or the requested worktree failed, before selection or session creation started. */
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
