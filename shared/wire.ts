import { Schema, type Types } from "effect";
import {
  base64Bytes,
  IMAGE_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
} from "./session/attachments.ts";
import { DISPOSITIONS } from "./session/dispatch.ts";

export const Attachment = Schema.Struct({
  kind: Schema.Literal("image"),
  name: Schema.String.check(Schema.isMaxLength(MAX_ATTACHMENT_NAME_LENGTH)),
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

export const ToolCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.String,
  writtenPath: Schema.optional(Schema.String),
});

export const Usage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  totalTokens: Schema.Number,
  cost: Schema.Number,
});
export type Usage = typeof Usage.Type;

export const ToolExecution = Schema.Struct({
  id: Schema.String,
  parentId: Schema.optional(Schema.String),
  name: Schema.String,
  args: Schema.String,
  writtenPath: Schema.optional(Schema.String),
  argsOmitted: Schema.optional(Schema.Literal("size")),
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
  inputFingerprint: Schema.optional(Schema.String),
  attachments: Schema.optional(
    Schema.Array(Schema.Struct({ kind: Schema.Literal("image"), url: Schema.String })),
  ),
  skill: Schema.optional(
    Schema.Struct({ name: Schema.String, location: Schema.String, body: Schema.String }),
  ),
  toolCalls: Schema.optional(Schema.Array(ToolCall)),
  toolName: Schema.optional(Schema.String),
  toolCallId: Schema.optional(Schema.String),
  isError: Schema.optional(Schema.Boolean),
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.String),
  responseModel: Schema.optional(Schema.String),
  usage: Schema.optional(Usage),
  stopReason: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  nestedCalls: Schema.optional(Schema.Array(ToolExecution)),
  nestedCallsLost: Schema.optional(Schema.Literals(["arguments", "details"])),
});
export type RenderMsg = typeof RenderMsg.Type;

export const Dialog = Schema.Struct({
  id: Schema.String,
  generation: Schema.String,
  receivedAt: Schema.Number,
  timeoutMs: Schema.optional(Schema.Number),
  toolCallId: Schema.optional(Schema.String),
  questionId: Schema.optional(Schema.String),
  deadlineAt: Schema.NullOr(Schema.Number),
  deadlineKind: Schema.Literals(["pi-timeout", "host-recovery", "tool-end"]),
  method: Schema.Literals(["select", "confirm", "input", "editor"]),
  title: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Schema.String)),
  placeholder: Schema.optional(Schema.String),
  prefill: Schema.optional(Schema.String),
  concealed: Schema.optional(Schema.Literal(true)),
});
export type Dialog = typeof Dialog.Type;

export const DialogResolution = Schema.Struct({
  id: Schema.String,
  generation: Schema.String,
  reason: Schema.Literals(["answered", "cancelled", "expired", "aborted", "recovery", "exited"]),
  toolCallId: Schema.optional(Schema.String),
  questionId: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  delivery: Schema.Literals([
    "pending",
    "written",
    "accepted",
    "rejected",
    "uncertain",
    "not-sent",
  ]),
  detail: Schema.String,
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

export const PromptSubmission = Schema.Struct({
  id: Schema.Number,
  inputId: Schema.optional(Schema.String),
  inputFingerprint: Schema.optional(Schema.String),
  outcome: Schema.Literals([
    "submitting",
    "started",
    "queued",
    "handled",
    "rejected",
    "not_sent",
    "uncertain",
  ]),
  detail: Schema.optional(Schema.String),
});
export type PromptSubmission = typeof PromptSubmission.Type;

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

export const SessionClosure = Schema.Union([
  Schema.TaggedStruct("released", { detail: Schema.String }),
  Schema.TaggedStruct("released_during_work", { detail: Schema.String }),
  Schema.TaggedStruct("stopped", { detail: Schema.String }),
  Schema.TaggedStruct("exited", { code: Schema.Number, detail: Schema.String }),
  Schema.TaggedStruct("failed", { detail: Schema.String }),
]);
export type SessionClosure = typeof SessionClosure.Type;

export const ArtifactPublication = Schema.Struct({
  artifactId: Schema.String,
  title: Schema.String,
  url: Schema.String,
  revision: Schema.Number,
  operationKey: Schema.String,
});

export const SessionState = Schema.Struct({
  artifacts: Schema.optional(Schema.Array(ArtifactPublication)),
  sessionId: Schema.String,
  sessionFile: Schema.optional(Schema.String),
  sessionName: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.String),
  isStreaming: Schema.Boolean,
  isCompacting: Schema.optional(Schema.Boolean),
  isStopping: Schema.optional(Schema.Boolean),
  isRetrying: Schema.optional(Schema.Boolean),
  submission: Schema.optional(PromptSubmission),
  dialogResolution: Schema.optional(DialogResolution),
  queuedMessages: Schema.optional(Schema.Array(QueuedMessage)),
  context: SessionStats.fields.context,
  contextIsLastKnown: Schema.optional(Schema.Boolean),
  statsUpdatedAt: Schema.optional(Schema.Number),
  cost: SessionStats.fields.cost,
  tokens: SessionStats.fields.tokens,
  dispatchedFrom: Schema.optional(Schema.String),
  extension: Schema.optional(ExtensionState),
  projectionError: Schema.optional(Schema.String),
  stateRefreshError: Schema.optional(Schema.String),
  statsRefreshError: Schema.optional(Schema.String),
  isQuiescent: Schema.optional(Schema.Boolean),
  closure: Schema.optional(SessionClosure),
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

export const SessionEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", { snapshot: Snapshot }),
  Schema.TaggedStruct("state", { state: SessionState }),
  Schema.TaggedStruct("response_completed", {}),
  Schema.TaggedStruct("response_failed", { detail: Schema.String }),
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
export type ProviderLoginState = Types.Mutable<typeof ProviderLoginState.Type>;

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

export const SessionActionResult = Schema.Union([
  Schema.TaggedStruct("queue_restored", {
    messages: Schema.Array(QueuedMessage),
    stopError: Schema.optional(Schema.String),
  }),
]);
export type SessionActionResult = typeof SessionActionResult.Type;

export const Workspace = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  path: Schema.String,
});
export type Workspace = typeof Workspace.Type;

export const CHANGES_INITIAL_PATCH_BYTES = 120_000;
export const CHANGES_FILE_PATCH_BYTES = 1024 * 1024;
export const CHANGES_ANSWER_BYTES = 4 * 1024 * 1024;
export const CHECKOUT_TIMEOUT_MS = 30_000;
export const PULL_REQUEST_TIMEOUT_MS = 45_000;
export const SLASH_COMMANDS_TIMEOUT_MS = 45_000;

export const ChangeFile = Schema.Struct({
  path: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  binary: Schema.Boolean,
  staged: Schema.optional(Schema.Literal(true)),
});
export type ChangeFile = typeof ChangeFile.Type;
export const ChangesScope = Schema.Literals(["branch", "uncommitted"]);
export type ChangesScope = typeof ChangesScope.Type;
export const ComparisonTarget = Schema.Struct({
  name: Schema.String,
  ref: Schema.String,
  commit: Schema.String,
  from: Schema.Literals(["pull-request", "worktree", "remote-default", "assumed"]),
});
export type ComparisonTarget = typeof ComparisonTarget.Type;
export const Comparison = Schema.Struct({
  scope: ChangesScope,
  base: Schema.String,
  target: Schema.optional(ComparisonTarget),
});
export type Comparison = typeof Comparison.Type;
export const ScopeAvailability = Schema.Struct({
  scope: ChangesScope,
  available: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  target: Schema.optional(ComparisonTarget),
});
export type ScopeAvailability = typeof ScopeAvailability.Type;
export const LocalWork = Schema.Struct({
  commitsNotPushed: Schema.NullOr(Schema.Number),
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
      pullRequestFromBranch: Schema.Boolean,
      comparison: Comparison,
      scopes: Schema.Array(ScopeAvailability),
      local: LocalWork,
      files: Schema.Array(ChangeFile),
      diff: Schema.String,
      truncated: Schema.Boolean,
    }),
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

export const WrittenFile = Schema.Union([
  Schema.Struct({ path: Schema.String, verdict: Schema.Literal("outside") }),
  Schema.Struct({
    path: Schema.String,
    verdict: Schema.Literals(["listed", "ignored", "missing"]),
    placed: Schema.String,
  }),
]);
export type WrittenFile = typeof WrittenFile.Type;

export const WorkspaceWrittenFiles = Schema.Struct({
  workspace: Workspace,
  observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({ status: Schema.Literal("ready"), files: Schema.Array(WrittenFile) }),
    Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
  ]),
});
export type WorkspaceWrittenFiles = typeof WorkspaceWrittenFiles.Type;

export const sameWorkspace = (a: Workspace, b: Workspace) =>
  a.id === b.id && a.path === b.path && a.folder === b.folder;

const trimmedFit = (max: number) => Schema.makeFilter((t: string) => t.trim().length <= max);
export const PROJECT_NAME_MAX = 80;
export const SESSION_TITLE_MAX = 200;
const sessionTitleFit = trimmedFit(SESSION_TITLE_MAX);
export const PROJECT_INSTRUCTIONS_MAX = 20_000;
export const ProjectInstructions = Schema.String.check(
  Schema.isMinLength(1),
  trimmedFit(PROJECT_INSTRUCTIONS_MAX),
);
export const ProjectName = Schema.String.check(Schema.isMinLength(1), trimmedFit(PROJECT_NAME_MAX));
export const Project = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String.check(Schema.isMinLength(1)),
  instructions: Schema.optional(ProjectInstructions),
  doneAt: Schema.optional(Schema.String),
});
export type Project = typeof Project.Type;
export const SessionPullRequestLink = Schema.Struct({
  url: Schema.String,
  source: Schema.Literals(["branch", "manual"]),
  apiHost: Schema.optional(Schema.Literal("github.int.exe.xyz")),
  head: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  headRepo: Schema.optional(Schema.String),
  baseRepo: Schema.optional(Schema.String),
});
export type SessionPullRequestLink = typeof SessionPullRequestLink.Type;
export const SessionReference = Schema.Struct({
  cwd: Schema.String,
  sessionId: Schema.String,
  title: Schema.optional(Schema.String),
  workspaceId: Schema.String,
  pullRequest: Schema.optional(Schema.NullOr(SessionPullRequestLink)),
  branch: Schema.NullOr(Schema.String),
  projectId: Schema.optional(Schema.String),
  archived: Schema.Boolean,
  pinned: Schema.optional(Schema.Boolean),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  unavailable: Schema.optional(Schema.Literals(["history", "checkout"])),
});
export type SessionReference = typeof SessionReference.Type;

export const sessionKey = (cwd: string, sessionId: string) => JSON.stringify([cwd, sessionId]);
export const sameSession = (
  a: { readonly cwd: string; readonly sessionId: string },
  b: { readonly cwd: string; readonly sessionId: string },
) => a.cwd === b.cwd && a.sessionId === b.sessionId;

export const WorktreeFacts = Schema.Struct({
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  detached: Schema.Boolean,
  head: Schema.optional(Schema.String),
  prunable: Schema.Boolean,
  github: Schema.optional(Schema.Struct({ repo: Schema.String, branch: Schema.String })),
});
export type WorktreeFacts = typeof WorktreeFacts.Type;
export const WorktreeDiscovery = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ready"),
    observedAt: Schema.String,
    currentPath: Schema.String,
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
export const ProjectTrust = Schema.Struct({
  required: Schema.Boolean,
  trusted: Schema.Boolean,
});
export type ProjectTrust = typeof ProjectTrust.Type;
export const WorktreeView = Schema.Struct({
  workspace: Workspace,
  trust: ProjectTrust,
  branch: Schema.NullOr(Schema.String),
  path: Schema.String,
  root: Schema.Boolean,
  status: Schema.Literals(["current", "missing", "unknown", "non-git"]),
  facts: Schema.optional(WorktreeFacts),
});
export type WorktreeView = typeof WorktreeView.Type;

export const FolderView = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
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
  thinkingLevels: Schema.Array(ThinkingLevel),
});
export type ModelChoice = typeof ModelChoice.Type;

export const ModelCatalog = Schema.Struct({
  cwd: Schema.String,
  models: Schema.Array(ModelChoice),
  commands: Schema.optional(Schema.Array(SlashCommand)),
  defaultModel: Schema.optional(Schema.String),
  defaultThinkingLevel: Schema.optional(Schema.String),
  fetchedAt: Schema.String,
  error: Schema.optional(Schema.String),
});
export type ModelCatalog = typeof ModelCatalog.Type;

export const SessionDefaults = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: ThinkingLevel,
});
export type SessionDefaults = typeof SessionDefaults.Type;

export const DirEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  gitSubject: Schema.optional(Schema.String),
});
export const DirListing = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  home: Schema.String,
  gitSubject: Schema.optional(Schema.String),
  gitRoot: Schema.optional(Schema.String),
  entries: Schema.Array(DirEntry),
});
export type DirListing = typeof DirListing.Type;

export const PullRequest = Schema.Struct({
  url: Schema.String,
  repo: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.Literals(["open", "draft", "merged", "closed"]),
  checks: Schema.Literals(["none", "unknown", "pending", "success", "failure"]),
  review: Schema.Literals(["none", "approved", "changes_requested", "review_required"]),
  author: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  headRepo: Schema.optional(Schema.String),
  baseRepo: Schema.optional(Schema.String),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
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
  working: Schema.Boolean,
  starting: Schema.optional(Schema.Boolean),
});
export type HostInfo = typeof HostInfo.Type;

export const StartOptions = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(ThinkingLevel),
  name: Schema.optional(Schema.String.check(sessionTitleFit)),
  dispatchedFrom: Schema.optional(Schema.String),
});
export type StartOptions = typeof StartOptions.Type;

export const WorktreeRequest = Schema.Struct({ branch: Schema.String });
export type WorktreeRequest = typeof WorktreeRequest.Type;
export const WORKTREE_CREATION_MS = 60_000;

export const SessionStatusFacts = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  disposition: Schema.Literals(DISPOSITIONS),
  since: Schema.NullOr(Schema.String),
  needs: Schema.NullOr(Schema.Struct({ title: Schema.String, kind: Schema.String })),
  lastAnswer: Schema.NullOr(Schema.String),
  changes: Schema.NullOr(
    Schema.Struct({
      branch: Schema.NullOr(Schema.String),
      files: Schema.Number,
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
  Schema.TaggedStruct("models", {
    cwd: Schema.String,
    requestId: Schema.String,
  }),
  Schema.TaggedStruct("save_project", {
    project: Schema.Struct({
      id: Project.fields.id,
      name: ProjectName,
      instructions: Schema.optional(ProjectInstructions),
    }),
    assign: Schema.optional(Schema.Struct({ cwd: Schema.String, sessionId: Schema.String })),
  }),
  Schema.TaggedStruct("delete_project", { id: Schema.String }),
  Schema.TaggedStruct("update_project", {
    id: Schema.String,
    name: Schema.optional(ProjectName),
    instructions: Schema.optional(Schema.NullOr(ProjectInstructions)),
  }),
  Schema.TaggedStruct("assign_project", {
    cwd: Schema.String,
    sessionId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("set_project_done", { id: Schema.String, done: Schema.Boolean }),
  Schema.TaggedStruct("remove_folder", { path: Schema.String }),
  Schema.TaggedStruct("set_trust", {
    requestId: Schema.String,
    path: Schema.String,
    trusted: Schema.Boolean,
  }),
  Schema.TaggedStruct("directory", { cwd: Schema.String, requestId: Schema.String }),
  Schema.TaggedStruct("select", {
    selectionId: Schema.String,
    attemptId: Schema.optional(Schema.String),
    cwd: Schema.String,
    sessionId: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("create_session", {
    selectionId: Schema.String,
    attemptId: Schema.optional(Schema.String),
    cwd: Schema.String,
    projectId: Schema.optional(Schema.String),
    inheritProject: Schema.optional(Schema.Boolean),
    options: StartOptions,
    worktree: Schema.optional(WorktreeRequest),
    text: Schema.optional(Schema.String),
    attachments: attachmentInput,
  }),
  Schema.TaggedStruct("session_status", {
    requestId: Schema.String,
    target: Schema.Union([
      Schema.Struct({ sessionId: Schema.String }),
      Schema.Struct({ projectId: Schema.String }),
    ]),
  }),
  Schema.TaggedStruct("act", {
    selectionId: Schema.String,
    action: SessionAction,
    start: Schema.optional(StartOptions),
  }),
  Schema.TaggedStruct("ping", { nonce: Schema.String }),
  Schema.TaggedStruct("ack", { deliveryId: Schema.Number }),
  Schema.TaggedStruct("rename_session", {
    cwd: Schema.String,
    sessionId: Schema.String,
    title: Schema.String.check(sessionTitleFit),
  }),
  Schema.TaggedStruct("pin_session", {
    cwd: Schema.String,
    sessionId: Schema.String,
    pinned: Schema.Boolean,
  }),
  Schema.TaggedStruct("archive_session", { cwd: Schema.String, sessionId: Schema.String }),
  Schema.TaggedStruct("unarchive_session", {
    cwd: Schema.String,
    sessionId: Schema.String,
    requestId: Schema.String,
  }),
  Schema.TaggedStruct("archive_all_sessions", { requestId: Schema.String }),
  Schema.TaggedStruct("archive_sessions_count", { requestId: Schema.String }),
  Schema.TaggedStruct("delete_session", { cwd: Schema.String, sessionId: Schema.String }),
]);
export type ClientMessage = typeof ClientMessage.Type;
export type ClientCommand = ClientMessage extends infer M
  ? M extends ClientMessage
    ? Omit<M, "selectionId">
    : never
  : never;

export const ServerMessage = Schema.Union([
  Schema.TaggedStruct("pong", { nonce: Schema.String }),
  Schema.TaggedStruct("registry", {
    folders: Schema.Array(FolderView),
    projects: Schema.optional(Schema.Array(Project)),
    sessionReferences: Schema.optional(Schema.Array(SessionReference)),
    workspaces: Schema.optional(Schema.Array(Workspace)),
  }),
  Schema.TaggedStruct("models", {
    catalog: ModelCatalog,
    requestId: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("models_failed", {
    cwd: Schema.String,
    requestId: Schema.String,
    message: Schema.String,
  }),
  Schema.TaggedStruct("catalogs_invalidated", {}),
  Schema.TaggedStruct("directory", {
    cwd: Schema.String,
    requestId: Schema.String,
    result: Schema.Union([
      Schema.Struct({
        status: Schema.Literal("ready"),
        catalog: ModelCatalog,
        trust: ProjectTrust,
      }),
      Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
    ]),
  }),
  Schema.TaggedStruct("trust", {
    cwd: Schema.String,
    trust: ProjectTrust,
    requestId: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("trust_failed", {
    requestId: Schema.String,
    cwd: Schema.String,
    message: Schema.String,
  }),
  Schema.TaggedStruct("hosts", { hosts: Schema.Array(HostInfo) }),
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
  Schema.TaggedStruct("data_controls_result", {
    requestId: Schema.String,
    result: Schema.Union([
      Schema.Struct({ status: Schema.Literal("ready"), count: Schema.Number }),
      Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
    ]),
  }),
  Schema.TaggedStruct("session_status", {
    requestId: Schema.String,
    result: Schema.Union([
      Schema.Struct({
        status: Schema.Literal("ready"),
        sessions: Schema.Array(SessionStatusFacts),
      }),
      Schema.Struct({ status: Schema.Literal("unlisted"), detail: Schema.String }),
      Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
    ]),
  }),
  Schema.TaggedStruct("selection_rejected", {
    selectionId: Schema.String,
    inputId: Schema.optional(Schema.String),
    message: Schema.String,
  }),
  Schema.TaggedStruct("selection_failed", {
    selectionId: Schema.String,
    message: Schema.String,
  }),
  Schema.TaggedStruct("error", {
    message: Schema.String,
    selectionId: Schema.optional(Schema.String),
    inputId: Schema.optional(Schema.String),
    cwd: Schema.optional(Schema.String),
    sessionId: Schema.optional(Schema.String),
  }),
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

export const CloseCode = {
  refused: 1008,
  tooLarge: 1009,
  ended: 1011,
  tryAgainLater: 1013,
} as const;
export type DisconnectReason = "behind" | "too-large";
export const disconnectReason = (code: number): DisconnectReason | undefined =>
  code === CloseCode.tooLarge
    ? "too-large"
    : code === CloseCode.tryAgainLater
      ? "behind"
      : undefined;
