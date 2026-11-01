/**
 * The HTTP seam, as wire.ts is for the socket: one table of `/api/*` endpoints that the server
 * router (server/Router.ts) and the browser adapter (web/src/lib/api.ts) both derive from.
 *
 * Paths never travel in URLs, so access logs and proxies never record them: a URL may carry only
 * registered IDs in its query string, and a filesystem path travels in a POST body. `endpoint`
 * enforces that shape: the query names only ID parameters, the path has no parameters of its own,
 * and a GET has no body.
 */
import { Schema } from "effect";
import { FileDownload, FilePreview } from "./files.ts";
import { McpSetupRequest, McpSetupState } from "./mcp.ts";
import { Prompt, PromptCreate } from "./prompts.ts";
import { API_KEY_INVALID, ApiKeyProvider, ProviderApiKeyChange } from "./providerApiKeys.ts";
import { RadiusSetupRequest, RadiusSetupState } from "./radius.ts";
import { SessionShare } from "./share.ts";
import { UserSkill, UserSkillCreate } from "./skills.ts";
import { Webhook, WebhookDelivery, WebhookSave } from "./webhooks.ts";
import {
  ChangesScope,
  DirListing,
  FolderView,
  OAuthProvider,
  ProviderLoginState,
  SessionDefaults,
  SessionPullRequest,
  SessionPullRequestAction,
  SlashCommand,
  Workspace,
  WorkspaceChanges,
  WorkspaceWrittenFiles,
} from "./wire.ts";

/**
 * How many paths one written-files request carries. A session writes as many files as it writes,
 * so this bounds the request, not the question: the browser adapter reads a longer list in
 * batches of this size and answers it as one observation.
 */
export const WRITTEN_PATHS_LIMIT = 1000;

/** The paths a session wrote, as its tool calls named them, at most `WRITTEN_PATHS_LIMIT`. */
const WrittenPaths = Schema.Struct({
  paths: Schema.Array(Schema.String.check(Schema.isMaxLength(4096))).check(
    Schema.isMaxLength(WRITTEN_PATHS_LIMIT),
  ),
});

export type Method = "GET" | "POST" | "PUT" | "DELETE";

/** The only values a URL carries: IDs the registry resolves. The server answers 404 for an unknown one. */
export type IdParam = "workspaceId" | "sessionId";

/**
 * The message for a failure the user cannot act on: the browser shows it when the server sent no
 * `error` of its own (`status` 0: no response), and the server answers an unexpected failure (500)
 * with it, never with the failure's own message.
 */
export type Fallback = string | ((status: number) => string);

/** A JSON Schema that needs no services to decode or encode. */
export type Json = Schema.ConstraintCodec<unknown, unknown, never, never>;

/** The status a service's refusal (a tagged error carrying a `detail` for people) is answered with. */
export type RefusedStatus = 400 | 409 | 502;

export interface Endpoint<
  Q extends IdParam = IdParam,
  B extends Json | undefined = Json | undefined,
  R extends Json = Json,
  F extends RefusedStatus | undefined = RefusedStatus | undefined,
> {
  readonly method: Method;
  readonly path: `/api/${string}`;
  /** Required ID parameters; `sessionId` is always resolved within `workspaceId`. */
  readonly query: ReadonlyArray<Q>;
  /** JSON request body. A body outside it is answered 400 with `invalid`. */
  readonly body: B;
  readonly invalid: string;
  readonly response: R;
  /** Live facts: the server marks the response uncacheable and the browser bypasses its cache. */
  readonly noStore: boolean;
  /** The server answers a refusal with this status and its `detail`; anything else is a 500. */
  readonly refused: F;
  /** False for state that carries no transcript content, such as sign-in and setup state, so codes
   * and URLs reach the user intact; everything else leaves through the display projection. */
  readonly redact: boolean;
  readonly fallback: Fallback;
}

type NoPathParams<P extends string> = P extends `${string}${":" | "?" | "*"}${string}` ? never : P;

const endpoint = <
  const P extends `/api/${string}`,
  M extends Method,
  Q extends IdParam = never,
  B extends Json | undefined = undefined,
  R extends Json = Json,
  F extends RefusedStatus | undefined = undefined,
>(e: {
  method: M;
  path: NoPathParams<P>;
  query?: ReadonlyArray<Q>;
  body?: M extends "GET" ? undefined : B;
  invalid?: string;
  response: R;
  noStore?: boolean;
  refused?: F;
  redact?: boolean;
  fallback: Fallback;
}): Endpoint<Q, B, R, F> => ({
  method: e.method,
  path: e.path,
  query: e.query ?? [],
  body: e.body as B,
  invalid: e.invalid ?? "Invalid request.",
  response: e.response,
  noStore: e.noStore ?? false,
  refused: e.refused as F,
  redact: e.redact ?? true,
  fallback: e.fallback,
});

const RadiusReply = Schema.Struct({ state: RadiusSetupState });
const McpReply = Schema.Struct({ state: McpSetupState });

/**
 * One sign-in lane's four requests on one path: read the current attempt, start one for a subject
 * (a provider, or an MCP catalog server), answer its prompt, cancel it. Credential values and
 * callback URLs travel only in bodies; each request answers with the current attempt, or null when
 * none exists.
 */
const signInEndpoints = <const P extends `/api/${string}`>(path: NoPathParams<P>) => {
  const shared = {
    path,
    invalid: "Invalid sign-in request.",
    response: Schema.Struct({ state: Schema.NullOr(ProviderLoginState) }),
    noStore: true,
    refused: 409,
    redact: false,
    fallback: "Could not complete sign-in.",
  } as const;
  return {
    state: endpoint({ ...shared, method: "GET" }),
    // `provider` names the subject, as the attempt's own `provider` field does for both lanes.
    start: endpoint({
      ...shared,
      method: "POST",
      body: Schema.Struct({ provider: Schema.String }),
    }),
    answer: endpoint({
      ...shared,
      method: "PUT",
      body: Schema.Struct({
        id: Schema.String,
        promptId: Schema.String,
        value: Schema.String.check(Schema.isMaxLength(16_384)),
      }),
    }),
    cancel: endpoint({ ...shared, method: "DELETE", body: Schema.Struct({ id: Schema.String }) }),
  };
};
export type SignInEndpoints = ReturnType<typeof signInEndpoints>;

export const Endpoints = {
  // Folder picker

  listDirectory: endpoint({
    method: "POST",
    path: "/api/ls",
    body: Schema.Struct({ path: Schema.optional(Schema.String) }),
    response: DirListing,
    refused: 400,
    fallback: "Could not list this folder.",
  }),
  /** mkdir -p for the folder picker's "New folder". */
  makeDirectory: endpoint({
    method: "POST",
    path: "/api/mkdir",
    body: Schema.Struct({ path: Schema.NonEmptyString }),
    invalid: "path is required",
    response: Schema.Struct({ path: Schema.String }),
    refused: 400,
    fallback: "Could not create folder",
  }),
  folders: endpoint({
    method: "GET",
    path: "/api/folders",
    response: Schema.Struct({ folders: Schema.Array(FolderView) }),
    fallback: "Could not load folders.",
  }),

  // Workspace

  workspaceFile: endpoint({
    method: "POST",
    path: "/api/workspace/file",
    query: ["workspaceId"],
    body: Schema.Struct({ path: Schema.NonEmptyString.check(Schema.isMaxLength(4096)) }),
    response: FilePreview,
    noStore: true,
    refused: 400,
    fallback: "Could not read this file. Check the path and try again.",
  }),
  /** The same files the preview accepts, as exact bytes in an attachment: no display redaction. */
  workspaceFileDownload: endpoint({
    method: "POST",
    path: "/api/workspace/file/download",
    query: ["workspaceId"],
    body: Schema.Struct({ path: Schema.NonEmptyString.check(Schema.isMaxLength(4096)) }),
    response: FileDownload,
    noStore: true,
    refused: 400,
    fallback: "Could not download this file. Check the path and try again.",
  }),
  workspaceChanges: endpoint({
    method: "POST",
    path: "/api/workspace/changes",
    query: ["workspaceId"],
    response: WorkspaceChanges,
    fallback: (status) =>
      `Changes request failed (${status}). Refresh folders or inspect the server.`,
  }),
  workspaceChangedFile: endpoint({
    method: "POST",
    path: "/api/workspace/changes/file",
    query: ["workspaceId"],
    body: Schema.Struct({ path: Schema.String }),
    invalid: "File path is required in the request body.",
    response: WorkspaceChanges,
    fallback: (status) => `File request failed (${status}).`,
  }),
  /** The session's Changes: its saved scope, or the one in the body for this read. */
  sessionChanges: endpoint({
    method: "POST",
    path: "/api/session/changes",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ scope: Schema.optional(ChangesScope) }),
    invalid: "Invalid changes request.",
    response: WorkspaceChanges,
    fallback: (status) =>
      `Changes request failed (${status}). Refresh folders or inspect the server.`,
  }),
  /** One file's fresh patch under the scope the list was read with; the browser checks the base. */
  sessionChangedFile: endpoint({
    method: "POST",
    path: "/api/session/changes/file",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ path: Schema.String, scope: ChangesScope }),
    invalid: "File path and scope are required in the request body.",
    response: WorkspaceChanges,
    fallback: (status) => `File request failed (${status}).`,
  }),
  /** Save the session's scope (`null` for the Uncommitted default) and answer with a fresh read. */
  setSessionChangesScope: endpoint({
    method: "PUT",
    path: "/api/session/changes",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ scope: Schema.NullOr(ChangesScope) }),
    invalid: "Invalid changes scope.",
    response: WorkspaceChanges,
    noStore: true,
    refused: 409,
    fallback: "Could not save the comparison.",
  }),

  workspaceWrittenFiles: endpoint({
    method: "POST",
    path: "/api/workspace/files/written",
    query: ["workspaceId"],
    body: WrittenPaths,
    invalid: "File paths are required in the request body.",
    response: WorkspaceWrittenFiles,
    fallback: (status) => `Files request failed (${status}).`,
  }),

  // Session pull request (GitHub facts are live)

  sessionPullRequest: endpoint({
    method: "GET",
    path: "/api/session/pull-request",
    query: ["workspaceId", "sessionId"],
    response: SessionPullRequest,
    noStore: true,
    refused: 400,
    fallback: "Could not load the pull request.",
  }),
  changeSessionPullRequest: endpoint({
    method: "PUT",
    path: "/api/session/pull-request",
    query: ["workspaceId", "sessionId"],
    body: SessionPullRequestAction,
    invalid: "Invalid pull request request.",
    response: SessionPullRequest,
    noStore: true,
    refused: 400,
    fallback: "Could not load the pull request.",
  }),

  shareSession: endpoint({
    method: "POST",
    path: "/api/session/share",
    query: ["workspaceId", "sessionId"],
    response: SessionShare,
    noStore: true,
    refused: 409,
    fallback: "Sharing could not be confirmed. Check Radius artifacts before sharing again.",
  }),

  // Composer

  /** Before a session starts: the directory's probe answers. The path travels in the body. */
  slashCommands: endpoint({
    method: "POST",
    path: "/api/commands",
    body: Schema.Struct({ cwd: Schema.NonEmptyString }),
    invalid: "Directory is required.",
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    refused: 502,
    fallback: "Could not load commands.",
  }),
  /** A running session answers from its own child; a stopped one is never started to answer. */
  sessionCommands: endpoint({
    method: "GET",
    path: "/api/session/commands",
    query: ["workspaceId", "sessionId"],
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    noStore: true,
    refused: 409,
    fallback: "Could not load commands.",
  }),

  // Settings
  webhooks: endpoint({
    method: "GET",
    path: "/api/settings/webhooks",
    response: Schema.Array(Webhook),
    noStore: true,
    refused: 400,
    // The receiver URL is the user's own and is edited and saved back: redacting it would overwrite it.
    redact: false,
    fallback: "Could not load webhooks.",
  }),
  saveWebhook: endpoint({
    method: "PUT",
    path: "/api/settings/webhooks",
    body: WebhookSave,
    invalid: "Enter a URL and select at least one event.",
    response: Webhook,
    noStore: true,
    refused: 400,
    // The receiver URL is the user's own and is edited and saved back: redacting it would overwrite it.
    redact: false,
    fallback: "Could not save webhook.",
  }),
  removeWebhook: endpoint({
    method: "POST",
    path: "/api/settings/webhooks/remove",
    body: Schema.Struct({ id: Schema.String }),
    invalid: "Webhook ID required.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    noStore: true,
    refused: 400,
    fallback: "Could not delete webhook.",
  }),
  userSkills: endpoint({
    method: "GET",
    path: "/api/settings/skills",
    response: Schema.Array(UserSkill),
    noStore: true,
    // The user's own words, shown and kept as they wrote them.
    redact: false,
    fallback: "Could not load skills.",
  }),
  createUserSkill: endpoint({
    method: "POST",
    path: "/api/settings/skills",
    body: UserSkillCreate,
    invalid: "Enter a name, a description and instructions.",
    response: UserSkill,
    noStore: true,
    refused: 400,
    redact: false,
    fallback: "Could not create skill.",
  }),
  removeUserSkill: endpoint({
    method: "POST",
    path: "/api/settings/skills/remove",
    body: Schema.Struct({ name: Schema.String }),
    invalid: "Skill name required.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    noStore: true,
    refused: 400,
    fallback: "Could not delete skill.",
  }),
  testWebhook: endpoint({
    method: "POST",
    path: "/api/settings/webhooks/test",
    body: Schema.Struct({ id: Schema.String }),
    invalid: "Webhook ID required.",
    response: WebhookDelivery,
    noStore: true,
    refused: 400,
    // The receiver URL is the user's own and is edited and saved back: redacting it would overwrite it.
    redact: false,
    fallback: "Could not test webhook.",
  }),

  prompts: endpoint({
    method: "GET",
    path: "/api/settings/prompts",
    response: Schema.Array(Prompt),
    noStore: true,
    refused: 400,
    fallback: "Could not load prompts.",
  }),
  createPrompt: endpoint({
    method: "POST",
    path: "/api/settings/prompts",
    body: PromptCreate,
    invalid: "Enter a name and the prompt.",
    response: Prompt,
    noStore: true,
    refused: 400,
    fallback: "Could not save prompt.",
  }),
  removePrompt: endpoint({
    method: "POST",
    path: "/api/settings/prompts/remove",
    body: Schema.Struct({ name: Schema.String }),
    invalid: "Prompt name required.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    noStore: true,
    refused: 400,
    fallback: "Could not delete prompt.",
  }),

  saveDefaults: endpoint({
    method: "PUT",
    path: "/api/settings/defaults",
    body: SessionDefaults,
    invalid: "Choose a valid default model and effort.",
    response: Schema.Struct({ defaults: SessionDefaults }),
    refused: 400,
    fallback: "Could not save defaults. Try again.",
  }),
  radiusSetup: endpoint({
    method: "GET",
    path: "/api/settings/radius",
    response: RadiusReply,
    noStore: true,
    redact: false,
    fallback: "Could not load Radius setup.",
  }),
  changeRadiusSetup: endpoint({
    method: "POST",
    path: "/api/settings/radius",
    body: RadiusSetupRequest,
    invalid: "Invalid Radius setup action.",
    response: RadiusReply,
    noStore: true,
    refused: 409,
    redact: false,
    fallback: "Could not load Radius setup.",
  }),
  mcpSetup: endpoint({
    method: "GET",
    path: "/api/settings/mcp",
    response: McpReply,
    noStore: true,
    redact: false,
    fallback: "Could not load MCP servers.",
  }),
  changeMcpSetup: endpoint({
    method: "POST",
    path: "/api/settings/mcp",
    body: McpSetupRequest,
    invalid: "Invalid MCP setup action.",
    response: McpReply,
    noStore: true,
    refused: 409,
    redact: false,
    fallback: "Could not change MCP setup.",
  }),
  providerApiKeys: endpoint({
    method: "GET",
    path: "/api/provider-api-keys",
    noStore: true,
    response: Schema.Struct({ providers: Schema.Array(ApiKeyProvider) }),
    refused: 502,
    fallback: "Could not load API keys.",
  }),
  changeProviderApiKey: endpoint({
    method: "POST",
    path: "/api/provider-api-keys",
    body: ProviderApiKeyChange,
    invalid: API_KEY_INVALID,
    noStore: true,
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    refused: 409,
    fallback: "Could not change API key. Check the key and try again.",
  }),
  oauthProviders: endpoint({
    method: "GET",
    path: "/api/oauth-providers",
    noStore: true,
    response: Schema.Struct({ providers: Schema.Array(OAuthProvider) }),
    refused: 502,
    fallback: "Could not load providers.",
  }),
  providerLogout: endpoint({
    method: "POST",
    path: "/api/provider-logout",
    body: Schema.Struct({ provider: Schema.String }),
    invalid: "Invalid sign-out request.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    refused: 409,
    fallback: "Could not sign out. Try again.",
  }),

  // Sign-in: provider OAuth, and MCP server OAuth with the same attempt shape.

  providerLogin: signInEndpoints("/api/provider-login"),
  mcpLogin: signInEndpoints("/api/settings/mcp/login"),
} as const;

export type Endpoints = typeof Endpoints;

/**
 * The Files answer as bundles built before 1b9e6b6 decode it: which of the paths sent Git ignores,
 * which lie outside the workspace and which no longer exist, each as sent (an ignored path that no
 * longer exists is in both `ignored` and `missing`), and `placed[i]`, the name `inside[i]` places to.
 */
export const LegacyWorkspaceIgnoredFiles = Schema.Struct({
  workspace: Workspace,
  observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("ready"),
      ignored: Schema.Array(Schema.String),
      outside: Schema.Array(Schema.String),
      missing: Schema.Array(Schema.String),
      inside: Schema.Array(Schema.String),
      placed: Schema.Array(Schema.String),
    }),
    Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
  ]),
});
export type LegacyWorkspaceIgnoredFiles = typeof LegacyWorkspaceIgnoredFiles.Type;

/**
 * Endpoints the server still answers for browser tabs that loaded a bundle built before a
 * contract change, so a deploy does not break them until they reload. The current browser never
 * calls these; `web/src` must not import them.
 */
export const LegacyEndpoints = {
  /**
   * Superseded by `Endpoints.workspaceWrittenFiles` in 1b9e6b6. A tab built before it posts here,
   * and without an answer its Files list fails open and shows ignored, outside and removed paths.
   * Remove once every deployed Piano has served a bundle built from 1b9e6b6 or later and tabs
   * opened before that deploy have reloaded.
   */
  workspaceIgnoredFiles: endpoint({
    method: "POST",
    path: "/api/workspace/files/ignored",
    query: ["workspaceId"],
    body: WrittenPaths,
    invalid: "File paths are required in the request body.",
    response: LegacyWorkspaceIgnoredFiles,
    fallback: (status) => `Ignored files request failed (${status}).`,
  }),
} as const;
