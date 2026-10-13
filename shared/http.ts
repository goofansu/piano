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
import { McpSetupRequest, McpSetupState } from "./mcp.ts";
import { RadiusSetupState } from "./radius.ts";
import { SessionShare } from "./share.ts";
import {
  DirListing,
  FolderView,
  OAuthProvider,
  ProviderLoginState,
  SessionDefaults,
  SessionPullRequest,
  SessionPullRequestAction,
  SlashCommand,
  WorkspaceCapture,
  WorkspaceChanges,
} from "./wire.ts";

export type Method = "GET" | "POST" | "PUT" | "DELETE";

/** The only values a URL carries: IDs the registry resolves. The server answers 404 for an unknown one. */
export type IdParam = "workspaceId" | "sessionId";

/** The browser's message when the server sent no `error` of its own (`status` 0: no response). */
export type Fallback = string | ((status: number) => string);

/** A JSON Schema that needs no services to decode or encode. */
export type Json = Schema.ConstraintCodec<unknown, unknown, never, never>;

export interface Endpoint<
  Q extends IdParam = IdParam,
  B extends Json | undefined = Json | undefined,
  R extends Json = Json,
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
  readonly fallback: Fallback;
}

type NoPathParams<P extends string> = P extends `${string}${":" | "?" | "*"}${string}` ? never : P;

const endpoint = <
  const P extends `/api/${string}`,
  M extends Method,
  Q extends IdParam = never,
  B extends Json | undefined = undefined,
  R extends Json = Json,
>(e: {
  method: M;
  path: NoPathParams<P>;
  query?: ReadonlyArray<Q>;
  body?: M extends "GET" ? undefined : B;
  invalid?: string;
  response: R;
  noStore?: boolean;
  fallback: Fallback;
}): Endpoint<Q, B, R> => ({
  method: e.method,
  path: e.path,
  query: e.query ?? [],
  body: e.body as B,
  invalid: e.invalid ?? "Invalid request.",
  response: e.response,
  noStore: e.noStore ?? false,
  fallback: e.fallback,
});

export const RadiusSetupAction = Schema.Literals([
  "configure-mcp",
  "install-web-search",
  "remove-mcp",
  "uninstall-web-search",
]);
export type RadiusSetupAction = typeof RadiusSetupAction.Type;

/** Removal names the configuration the user reviewed, so a changed one is not removed blindly. */
const RadiusSetupRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literals(["configure-mcp", "install-web-search"]) }),
  Schema.Struct({
    action: Schema.Literals(["remove-mcp", "uninstall-web-search"]),
    removalKey: Schema.String,
  }),
]);

const RadiusReply = Schema.Struct({ state: RadiusSetupState });
const McpReply = Schema.Struct({ state: McpSetupState });
const LoginReply = Schema.Struct({ state: Schema.NullOr(ProviderLoginState) });
const loginFallback = "Could not complete sign-in.";
const loginInvalid = "Invalid sign-in request.";

export const Endpoints = {
  // Folder picker

  listDirectory: endpoint({
    method: "POST",
    path: "/api/ls",
    body: Schema.Struct({ path: Schema.optional(Schema.String) }),
    response: DirListing,
    fallback: "Could not list this folder.",
  }),
  /** mkdir -p for the folder picker's "New folder". */
  makeDirectory: endpoint({
    method: "POST",
    path: "/api/mkdir",
    body: Schema.Struct({ path: Schema.String }),
    invalid: "path is required",
    response: Schema.Struct({ path: Schema.String }),
    fallback: "Could not create folder",
  }),
  folders: endpoint({
    method: "GET",
    path: "/api/folders",
    response: Schema.Struct({ folders: Schema.Array(FolderView) }),
    fallback: "Could not load folders.",
  }),

  // Workspace

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
  workspaceCapture: endpoint({
    method: "POST",
    path: "/api/workspace/capture",
    query: ["workspaceId"],
    response: WorkspaceCapture,
    fallback: "Could not capture the workspace.",
  }),

  // Session pull request (GitHub facts are live)

  sessionPullRequest: endpoint({
    method: "GET",
    path: "/api/session/pull-request",
    query: ["workspaceId", "sessionId"],
    response: SessionPullRequest,
    noStore: true,
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
    fallback: "Could not load the pull request.",
  }),

  shareSession: endpoint({
    method: "POST",
    path: "/api/session/share",
    query: ["workspaceId", "sessionId"],
    response: SessionShare,
    noStore: true,
    fallback: "Sharing could not be confirmed. Check Radius artifacts before sharing again.",
  }),

  // Composer

  /** Before a session starts: the directory's probe answers. The path travels in the body. */
  slashCommands: endpoint({
    method: "POST",
    path: "/api/commands",
    body: Schema.Struct({ cwd: Schema.String }),
    invalid: "Directory is required.",
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    fallback: "Could not load commands.",
  }),
  /** A running session answers from its own child; a stopped one is never started to answer (409). */
  sessionCommands: endpoint({
    method: "GET",
    path: "/api/session/commands",
    query: ["workspaceId", "sessionId"],
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    noStore: true,
    fallback: "Could not load commands.",
  }),

  // Settings

  saveDefaults: endpoint({
    method: "PUT",
    path: "/api/settings/defaults",
    body: SessionDefaults,
    invalid: "Choose a valid default model and effort.",
    response: Schema.Struct({ defaults: SessionDefaults }),
    fallback: "Could not save defaults. Try again.",
  }),
  radiusSetup: endpoint({
    method: "GET",
    path: "/api/settings/radius",
    response: RadiusReply,
    noStore: true,
    fallback: "Could not load Radius setup.",
  }),
  changeRadiusSetup: endpoint({
    method: "POST",
    path: "/api/settings/radius",
    body: RadiusSetupRequest,
    invalid: "Invalid Radius setup action.",
    response: RadiusReply,
    noStore: true,
    fallback: "Could not load Radius setup.",
  }),
  mcpSetup: endpoint({
    method: "GET",
    path: "/api/settings/mcp",
    response: McpReply,
    noStore: true,
    fallback: "Could not load MCP servers.",
  }),
  changeMcpSetup: endpoint({
    method: "POST",
    path: "/api/settings/mcp",
    body: McpSetupRequest,
    invalid: "Invalid MCP setup action.",
    response: McpReply,
    noStore: true,
    fallback: "Could not change MCP setup.",
  }),
  oauthProviders: endpoint({
    method: "GET",
    path: "/api/oauth-providers",
    noStore: true,
    response: Schema.Struct({ providers: Schema.Array(OAuthProvider) }),
    fallback: "Could not load providers.",
  }),
  providerLogout: endpoint({
    method: "POST",
    path: "/api/provider-logout",
    body: Schema.Struct({ provider: Schema.String }),
    invalid: "Invalid sign-out request.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    fallback: "Could not sign out. Try again.",
  }),

  // Provider sign-in. Credential values and callback URLs travel only in bodies; each request
  // answers with the current attempt, or null when none exists.

  providerLoginState: endpoint({
    method: "GET",
    path: "/api/provider-login",
    response: LoginReply,
    noStore: true,
    fallback: loginFallback,
  }),
  startProviderLogin: endpoint({
    method: "POST",
    path: "/api/provider-login",
    body: Schema.Struct({ provider: Schema.String }),
    invalid: loginInvalid,
    response: LoginReply,
    noStore: true,
    fallback: loginFallback,
  }),
  answerProviderLogin: endpoint({
    method: "PUT",
    path: "/api/provider-login",
    body: Schema.Struct({
      id: Schema.String,
      promptId: Schema.String,
      value: Schema.String.check(Schema.isMaxLength(16_384)),
    }),
    invalid: loginInvalid,
    response: LoginReply,
    noStore: true,
    fallback: loginFallback,
  }),
  cancelProviderLogin: endpoint({
    method: "DELETE",
    path: "/api/provider-login",
    body: Schema.Struct({ id: Schema.String }),
    invalid: loginInvalid,
    response: LoginReply,
    noStore: true,
    fallback: loginFallback,
  }),

  // MCP server sign-in: the same attempt shape as provider sign-in, run by Pi's MCP OAuth.

  mcpLoginState: endpoint({
    method: "GET",
    path: "/api/settings/mcp/login",
    response: LoginReply,
    noStore: true,
    fallback: loginFallback,
  }),
  startMcpLogin: endpoint({
    method: "POST",
    path: "/api/settings/mcp/login",
    body: Schema.Struct({ server: Schema.String }),
    invalid: loginInvalid,
    response: LoginReply,
    noStore: true,
    fallback: loginFallback,
  }),
  answerMcpLogin: endpoint({
    method: "PUT",
    path: "/api/settings/mcp/login",
    body: Schema.Struct({
      id: Schema.String,
      promptId: Schema.String,
      value: Schema.String.check(Schema.isMaxLength(16_384)),
    }),
    invalid: loginInvalid,
    response: LoginReply,
    noStore: true,
    fallback: loginFallback,
  }),
  cancelMcpLogin: endpoint({
    method: "DELETE",
    path: "/api/settings/mcp/login",
    body: Schema.Struct({ id: Schema.String }),
    invalid: loginInvalid,
    response: LoginReply,
    noStore: true,
    fallback: loginFallback,
  }),
} as const;

export type Endpoints = typeof Endpoints;
