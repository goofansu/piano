/**
 * The browser's half of the HTTP seam: one function per endpoint of shared/http.ts, the table the
 * server router also serves. Each response is decoded against the endpoint's Schema, and every
 * failure has one error shape.
 *
 * Paths never travel in URLs: registered workspaces and sessions are addressed by ID in the query
 * string, filesystem paths in a request body.
 */
import { Schema } from "effect";
// Relative so module tests can load the Schemas under plain Node, which has no `@shared` alias.
import { type Endpoint, Endpoints, type IdParam, type Json, type RadiusSetupAction } from "../../../shared/http.ts";
import type { McpSetupRequest } from "../../../shared/mcp.ts";
import type { SessionPullRequestAction, ThinkingLevel } from "../../../shared/wire.ts";

export type { RadiusSetupAction };

/**
 * Every failed request: the server's own `error` message when it sent one, otherwise the
 * endpoint's fallback. `status` is 0 when no response arrived. Aborts are rethrown unchanged.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** What a call sends: the endpoint's ID parameters and, when it has one, its body. */
type Input<Q extends IdParam, B extends Json | undefined> =
  & ([Q] extends [never] ? unknown : { readonly query: Readonly<Record<Q, string>> })
  & (B extends Json ? { readonly body: B["Type"] } : unknown);

async function call<Q extends IdParam, B extends Json | undefined, R extends Json>(
  endpoint: Endpoint<Q, B, R>, input: Input<Q, B>, { signal }: RequestOptions = {},
): Promise<R["Type"]> {
  const { method, path, noStore, fallback } = endpoint;
  const { query, body } = input as { query?: Record<string, string>; body?: unknown };
  const failure = (status: number) => typeof fallback === "string" ? fallback : fallback(status);
  let response: Response;
  try {
    response = await fetch(query ? `${path}?${new URLSearchParams(query)}` : path, {
      method, signal, ...(noStore ? { cache: "no-store" as const } : {}),
      ...(endpoint.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(failure(0), 0);
  }
  // A proxy or crashed server may answer with something other than JSON.
  const json: unknown = await response.json().catch(error => {
    if (signal?.aborted) throw error;
    return undefined;
  });
  if (!response.ok) {
    const message = json && typeof json === "object" && "error" in json && typeof json.error === "string" && json.error ? json.error : failure(response.status);
    throw new ApiError(message, response.status);
  }
  const decoded = Schema.decodeUnknownExit(endpoint.response)(json);
  if (decoded._tag === "Failure") throw new ApiError(failure(response.status), response.status);
  return decoded.value;
}

// Folder picker

export const listDirectory = (path: string, options?: RequestOptions) =>
  call(Endpoints.listDirectory, { body: { path } }, options);

export const makeDirectory = async (path: string, options?: RequestOptions) =>
  (await call(Endpoints.makeDirectory, { body: { path } }, options)).path;

// Live workspace changes

export const workspaceChanges = (workspaceId: string, options?: RequestOptions) =>
  call(Endpoints.workspaceChanges, { query: { workspaceId } }, options);

export const workspaceChangedFile = (workspaceId: string, path: string, options?: RequestOptions) =>
  call(Endpoints.workspaceChangedFile, { query: { workspaceId }, body: { path } }, options);

// Session pull request

/** Reads always bypass the HTTP cache: GitHub facts are live. */
export const sessionPullRequest = (workspaceId: string, sessionId: string, action?: SessionPullRequestAction, options?: RequestOptions) =>
  action
    ? call(Endpoints.changeSessionPullRequest, { query: { workspaceId, sessionId }, body: action }, options)
    : call(Endpoints.sessionPullRequest, { query: { workspaceId, sessionId } }, options);

// Composer

/** A live session answers from its own child; otherwise the directory's probe does. */
export const slashCommands = async (cwd: string, sessionId: string | undefined, options?: RequestOptions) =>
  (await call(Endpoints.slashCommands, { body: { cwd, sessionId } }, options)).commands;

export const saveDefaults = async (model: string | undefined, thinkingLevel: ThinkingLevel, options?: RequestOptions) =>
  (await call(Endpoints.saveDefaults, { body: { model, thinkingLevel } }, options)).defaults;

// Settings

export const oauthProviders = async (options?: RequestOptions) =>
  (await call(Endpoints.oauthProviders, {}, options)).providers;

export const providerLogout = async (provider: string, options?: RequestOptions) => {
  await call(Endpoints.providerLogout, { body: { provider } }, options);
};

/** Each sign-in request answers with the current attempt, or null when none exists. */
export type ProviderLoginRequest =
  | { method: "GET" }
  | { method: "POST"; body: typeof Endpoints.startProviderLogin.body.Type }
  | { method: "PUT"; body: typeof Endpoints.answerProviderLogin.body.Type }
  | { method: "DELETE"; body: typeof Endpoints.cancelProviderLogin.body.Type };

export const providerLogin = async (request: ProviderLoginRequest = { method: "GET" }, options?: RequestOptions) => {
  switch (request.method) {
    case "GET": return (await call(Endpoints.providerLoginState, {}, options)).state;
    case "POST": return (await call(Endpoints.startProviderLogin, request, options)).state;
    case "PUT": return (await call(Endpoints.answerProviderLogin, request, options)).state;
    case "DELETE": return (await call(Endpoints.cancelProviderLogin, request, options)).state;
  }
};

/** The same sign-in attempt as providers', run by Pi's MCP OAuth for a catalog server. */
export const mcpLogin = async (request: ProviderLoginRequest = { method: "GET" }, options?: RequestOptions) => {
  switch (request.method) {
    case "GET": return (await call(Endpoints.mcpLoginState, {}, options)).state;
    case "POST": return (await call(Endpoints.startMcpLogin, { body: { server: request.body.provider } }, options)).state;
    case "PUT": return (await call(Endpoints.answerMcpLogin, request, options)).state;
    case "DELETE": return (await call(Endpoints.cancelMcpLogin, request, options)).state;
  }
};

export const mcpSetup = async (request?: McpSetupRequest, options?: RequestOptions) =>
  (request ? await call(Endpoints.changeMcpSetup, { body: request }, options) : await call(Endpoints.mcpSetup, {}, options)).state;

export const radiusSetup = async (action?: { action: RadiusSetupAction; removalKey?: string }, options?: RequestOptions) =>
  (action
    ? await call(Endpoints.changeRadiusSetup, { body: action as typeof Endpoints.changeRadiusSetup.body.Type }, options)
    : await call(Endpoints.radiusSetup, {}, options)).state;
