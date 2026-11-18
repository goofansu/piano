import { Schema } from "effect";
import { FileDownload, FilePreview, LARGEST_PREVIEW_BYTES } from "./files.ts";
import { LIBRARY_KINDS, type LibraryKind, type LibraryKindWords } from "./library.ts";
import { Machines } from "./machine.ts";
import { McpSetupChange, McpSetupRequest, McpSetupState } from "./mcp.ts";
import { Prompt, PromptCreate, PromptProposal, PromptUpdate } from "./prompts.ts";
import { ApiKeyProvider, ProviderApiKeyChange } from "./providerApiKeys.ts";
import { RadiusSetupRequest, RadiusSetupState } from "./radius.ts";
import { SessionShareResult, SHARE_UNCONFIRMED, SESSION_SHARE_TIMEOUT_MS } from "./share.ts";
import { UserSkill, UserSkillCreate, UserSkillProposal, UserSkillUpdate } from "./skills.ts";
import {
  MAX_VOICE_REQUEST_BYTES,
  MAX_VOICE_REQUESTS,
  Transcription,
  TranscriptionRequest,
  VoiceInputSave,
  VoiceInputState,
} from "./voiceInput.ts";
import { Webhook, WebhookDelivery, WebhookSave } from "./webhooks.ts";
import {
  CHANGES_ANSWER_BYTES,
  CHECKOUT_TIMEOUT_MS,
  ChangesScope,
  DirListing,
  FolderView,
  OAuthProvider,
  ProviderLoginState,
  PULL_REQUEST_TIMEOUT_MS,
  SessionDefaults,
  SessionPullRequest,
  SessionPullRequestAction,
  SLASH_COMMANDS_TIMEOUT_MS,
  SlashCommand,
  WorkspaceChanges,
  WorkspaceWrittenFiles,
} from "./wire.ts";

export const WRITTEN_PATHS_LIMIT = 1000;

const WrittenPaths = Schema.Struct({
  paths: Schema.Array(Schema.String.check(Schema.isMaxLength(4096))).check(
    Schema.isMaxLength(WRITTEN_PATHS_LIMIT),
  ),
});

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export type IdParam = "workspaceId" | "sessionId";

export type Fallback = string | ((status: number) => string);

export type Json = Schema.ConstraintCodec<unknown, unknown, never, never>;

export function readRefusal(body: unknown, fallback: string): { error: string; field?: string } {
  const answer = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error = typeof answer.error === "string" && answer.error ? answer.error : fallback;
  return typeof answer.field === "string" ? { error, field: answer.field } : { error };
}

export interface Upload {
  readonly bytes: number;
  readonly concurrent: number;
  readonly busy: string;
  readonly tooLarge: string;
  readonly compressed: string;
  readonly unreadable: string;
  readonly timedOut: string;
}

export type RefusedStatus = 400 | 409 | 502;

export interface Endpoint<
  Q extends IdParam = IdParam,
  B extends Json | undefined = Json | undefined,
  R extends Json = Json,
  F extends RefusedStatus | undefined = RefusedStatus | undefined,
> {
  readonly method: Method;
  readonly path: `/api/${string}`;
  readonly query: ReadonlyArray<Q>;
  readonly body: B;
  readonly invalid: string;
  readonly response: R;
  readonly noStore: boolean;
  readonly refused: F;
  readonly redact: boolean;
  readonly fallback: Fallback;
  readonly upload: Upload | undefined;
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
  upload?: M extends "GET" ? undefined : Upload;
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
  upload: e.upload,
});

const RadiusReply = Schema.Struct({ state: RadiusSetupState });
const McpReply = Schema.Struct({ state: McpSetupState });

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

const libraryEndpoints = <E extends Json, C extends Json, U extends Json, P extends Json>(
  { kind, Noun }: LibraryKindWords,
  schemas: { entry: E; create: C; update: U; proposal: P },
) => {
  const path: `/api/settings/${LibraryKind}s` = `/api/settings/${kind}s`;
  const shared = { noStore: true, redact: false } as const;
  const save = {
    ...shared,
    invalid: "Enter a name, a description and instructions.",
    refused: 400,
  } as const;
  return {
    list: endpoint({
      ...shared,
      method: "GET",
      path,
      response: Schema.Array(schemas.entry),
      fallback: `Could not load ${kind}s.`,
    }),
    create: endpoint({
      ...save,
      method: "POST",
      path,
      body: schemas.create,
      response: schemas.entry,
      fallback: `Could not create ${kind}.`,
    }),
    propose: endpoint({
      ...save,
      method: "POST",
      path: `${path}/proposal`,
      body: schemas.create,
      response: schemas.proposal,
      fallback: `Could not save ${kind}.`,
    }),
    update: endpoint({
      ...save,
      method: "PUT",
      path,
      body: schemas.update,
      response: schemas.entry,
      fallback: `Could not save ${kind}.`,
    }),
    remove: endpoint({
      method: "POST",
      path: `${path}/remove`,
      body: Schema.Struct({ name: Schema.String }),
      invalid: `${Noun} name required.`,
      response: Schema.Struct({ ok: Schema.Literal(true) }),
      noStore: true,
      refused: 400,
      fallback: `Could not delete ${kind}.`,
    }),
  };
};

export const Endpoints = {
  machines: endpoint({
    method: "GET",
    path: "/api/machines",
    response: Schema.Struct({ machines: Machines }),
    noStore: true,
    redact: false,
    fallback: "Could not load machines.",
  }),

  listDirectory: endpoint({
    method: "POST",
    path: "/api/ls",
    body: Schema.Struct({ path: Schema.optional(Schema.String) }),
    response: DirListing,
    refused: 400,
    fallback: "Could not list this folder.",
  }),
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
  sessionChangedFile: endpoint({
    method: "POST",
    path: "/api/session/changes/file",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ path: Schema.String, scope: ChangesScope }),
    invalid: "File path and scope are required in the request body.",
    response: WorkspaceChanges,
    fallback: (status) => `File request failed (${status}).`,
  }),
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

  shareSession: endpoint({
    method: "POST",
    path: "/api/session/share",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ confirmed: Schema.Literal(true) }),
    response: SessionShareResult,
    noStore: true,
    refused: 409,
    fallback: SHARE_UNCONFIRMED,
  }),

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

  slashCommands: endpoint({
    method: "POST",
    path: "/api/commands",
    body: Schema.Struct({ cwd: Schema.NonEmptyString }),
    invalid: "Directory is required.",
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    refused: 502,
    fallback: "Could not load commands.",
  }),
  peerSlashCommands: endpoint({
    method: "POST",
    path: "/api/peer/commands",
    body: Schema.Struct({ cwd: Schema.NonEmptyString }),
    invalid: "Directory is required.",
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    refused: 409,
    fallback: "Could not load commands.",
  }),
  sessionCommands: endpoint({
    method: "GET",
    path: "/api/session/commands",
    query: ["workspaceId", "sessionId"],
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    noStore: true,
    refused: 409,
    fallback: "Could not load commands.",
  }),

  webhooks: endpoint({
    method: "GET",
    path: "/api/settings/webhooks",
    response: Schema.Array(Webhook),
    noStore: true,
    refused: 400,
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
  skills: libraryEndpoints(LIBRARY_KINDS.skill, {
    entry: UserSkill,
    create: UserSkillCreate,
    update: UserSkillUpdate,
    proposal: UserSkillProposal,
  }),
  testWebhook: endpoint({
    method: "POST",
    path: "/api/settings/webhooks/test",
    body: Schema.Struct({ id: Schema.String }),
    invalid: "Webhook ID required.",
    response: WebhookDelivery,
    noStore: true,
    refused: 400,
    redact: false,
    fallback: "Could not test webhook.",
  }),

  prompts: libraryEndpoints(LIBRARY_KINDS.prompt, {
    entry: Prompt,
    create: PromptCreate,
    update: PromptUpdate,
    proposal: PromptProposal,
  }),

  saveDefaults: endpoint({
    method: "PUT",
    path: "/api/settings/defaults",
    body: SessionDefaults,
    invalid: "Choose a valid default model and effort.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
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
    response: McpSetupChange,
    noStore: true,
    refused: 409,
    redact: false,
    fallback: "Could not change MCP setup.",
  }),
  voiceInput: endpoint({
    method: "GET",
    path: "/api/settings/voice-input",
    response: VoiceInputState,
    noStore: true,
    refused: 400,
    fallback: "Could not load voice input.",
  }),
  saveVoiceInput: endpoint({
    method: "PUT",
    path: "/api/settings/voice-input",
    body: VoiceInputSave,
    invalid: "Invalid voice input setting.",
    response: VoiceInputState,
    noStore: true,
    refused: 400,
    fallback: "Could not save voice input.",
  }),
  transcribe: endpoint({
    method: "POST",
    path: "/api/voice/transcribe",
    body: TranscriptionRequest,
    invalid: "The recording could not be sent. Record a shorter message.",
    response: Transcription,
    noStore: true,
    refused: 502,
    fallback: "Could not transcribe the recording.",
    upload: {
      bytes: MAX_VOICE_REQUEST_BYTES,
      concurrent: MAX_VOICE_REQUESTS,
      busy: "Voice input is busy. Try again later.",
      tooLarge: "The recording is too long. Record a shorter message.",
      compressed: "Compressed recordings are not supported.",
      unreadable: "Could not read the recording.",
      timedOut: "Recording upload timed out.",
    },
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
    invalid: "Invalid API key request.",
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

  providerLogin: signInEndpoints("/api/provider-login"),
  mcpLogin: signInEndpoints("/api/settings/mcp/login"),
} as const;

export type Endpoints = typeof Endpoints;

export interface RemoteRequest {
  readonly browser: Endpoint;
  readonly upstream: Endpoint;
  readonly invalid: string;
  readonly passRefusal: boolean;
  readonly answer?: "bytes";
  readonly bodyBytes?: number;
  readonly answerBytes?: number;
  readonly requestMs?: number;
}

export const answerJson = (body: unknown): string => JSON.stringify(body, null, 2);

const MiB = 1024 * 1024;
const changesAnswerBytes = CHANGES_ANSWER_BYTES + 64 * 1024;
const REMOTE_MARGIN_MS = 5_000;
const outlasting = (remoteMs: number) => remoteMs + REMOTE_MARGIN_MS;
const checkoutRequestMs = outlasting(CHECKOUT_TIMEOUT_MS);
const fileTransferMs = 60_000;
const fileAnswerBytes = LARGEST_PREVIEW_BYTES + 2 * MiB;
const sessionSurface = (
  endpoint: Endpoint,
  limits: Pick<RemoteRequest, "answer" | "bodyBytes" | "answerBytes" | "requestMs"> = {},
): RemoteRequest => ({
  browser: endpoint,
  upstream: endpoint,
  invalid: "Remote workspace or session ID, or the request itself, is invalid.",
  passRefusal: endpoint.refused !== undefined,
  ...limits,
});

export const RemoteRequests: ReadonlyArray<RemoteRequest> = [
  {
    browser: Endpoints.sessionCommands,
    upstream: Endpoints.sessionCommands,
    invalid: "Remote workspace and session IDs are required.",
    passRefusal: true,
    requestMs: outlasting(SLASH_COMMANDS_TIMEOUT_MS),
  },
  {
    browser: Endpoints.slashCommands,
    upstream: Endpoints.peerSlashCommands,
    invalid: "A remote folder is required.",
    passRefusal: true,
    requestMs: outlasting(SLASH_COMMANDS_TIMEOUT_MS),
  },
  {
    browser: Endpoints.saveDefaults,
    upstream: Endpoints.saveDefaults,
    invalid: Endpoints.saveDefaults.invalid,
    passRefusal: true,
  },
  sessionSurface(Endpoints.shareSession, { requestMs: outlasting(SESSION_SHARE_TIMEOUT_MS) }),
  sessionSurface(Endpoints.sessionChanges, {
    answerBytes: changesAnswerBytes,
    requestMs: checkoutRequestMs,
  }),
  sessionSurface(Endpoints.sessionChangedFile, {
    answerBytes: changesAnswerBytes,
    requestMs: checkoutRequestMs,
  }),
  sessionSurface(Endpoints.setSessionChangesScope, {
    answerBytes: changesAnswerBytes,
    requestMs: checkoutRequestMs,
  }),
  sessionSurface(Endpoints.workspaceWrittenFiles, { bodyBytes: MiB, requestMs: checkoutRequestMs }),
  sessionSurface(Endpoints.sessionPullRequest, {
    requestMs: outlasting(PULL_REQUEST_TIMEOUT_MS),
  }),
  sessionSurface(Endpoints.changeSessionPullRequest, {
    requestMs: outlasting(PULL_REQUEST_TIMEOUT_MS),
  }),
  sessionSurface(Endpoints.workspaceFile, {
    answer: "bytes",
    answerBytes: fileAnswerBytes,
    requestMs: fileTransferMs,
  }),
  sessionSurface(Endpoints.workspaceFileDownload, {
    answer: "bytes",
    answerBytes: fileAnswerBytes,
    requestMs: fileTransferMs,
  }),
];
