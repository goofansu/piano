/**
 * The browser's half of the HTTP seam, as shared/wire.ts is for the socket: one function per
 * `/api/*` endpoint, each response decoded against its shared Schema, and one error shape.
 *
 * Paths never travel in URLs: registered workspaces and sessions are addressed by ID in the query
 * string, filesystem paths in a POST body.
 */
import { Schema } from "effect";
// Relative so module tests can load the Schemas under plain Node, which has no `@shared` alias.
import { RadiusSetupState } from "../../../shared/radius.ts";
import {
  DirListing,
  OAuthProvider,
  ProviderLoginState,
  SessionDefaults,
  SessionPullRequest,
  type SessionPullRequestAction,
  SlashCommand,
  type ThinkingLevel,
  WorkspaceChanges,
} from "../../../shared/wire.ts";

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

type Fallback = string | ((status: number) => string);

interface Call {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Query parameters carry IDs only. */
  query?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  cache?: RequestCache;
  fallback: Fallback;
}

async function call<A>(path: string, schema: Schema.Decoder<A>, { method = "GET", query, body, signal, cache, fallback }: Call): Promise<A> {
  const failure = (status: number) => typeof fallback === "string" ? fallback : fallback(status);
  let response: Response;
  try {
    response = await fetch(query ? `${path}?${new URLSearchParams(query)}` : path, {
      method, signal, cache,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
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
  const decoded = Schema.decodeUnknownExit(schema)(json);
  if (decoded._tag === "Failure") throw new ApiError(failure(response.status), response.status);
  return decoded.value;
}

const Ok = Schema.Struct({ ok: Schema.Literal(true) });

// Folder picker

export const listDirectory = (path: string, options?: RequestOptions) =>
  call("/api/ls", DirListing, { method: "POST", body: { path }, ...options, fallback: "Could not list this folder." });

export const makeDirectory = async (path: string, options?: RequestOptions) =>
  (await call("/api/mkdir", Schema.Struct({ path: Schema.String }), { method: "POST", body: { path }, ...options, fallback: "Could not create folder" })).path;

// Live workspace changes

export const workspaceChanges = (workspaceId: string, options?: RequestOptions) =>
  call("/api/workspace/changes", WorkspaceChanges, {
    method: "POST", query: { workspaceId }, ...options,
    fallback: status => `Changes request failed (${status}). Refresh folders or inspect the server.`,
  });

export const workspaceChangedFile = (workspaceId: string, path: string, options?: RequestOptions) =>
  call("/api/workspace/changes/file", WorkspaceChanges, {
    method: "POST", query: { workspaceId }, body: { path }, ...options, fallback: status => `File request failed (${status}).`,
  });

// Session pull request

/** Reads always bypass the HTTP cache: GitHub facts are live. */
export const sessionPullRequest = (workspaceId: string, sessionId: string, action?: SessionPullRequestAction, options?: RequestOptions) =>
  call("/api/session/pull-request", SessionPullRequest, {
    method: action ? "PUT" : "GET", query: { workspaceId, sessionId }, body: action, cache: "no-store", ...options,
    fallback: "Could not load the pull request.",
  });

// Composer

/** A live session answers from its own child; otherwise the directory's probe does. */
export const slashCommands = async (cwd: string, sessionId: string | undefined, options?: RequestOptions) =>
  (await call("/api/commands", Schema.Struct({ commands: Schema.Array(SlashCommand) }), {
    method: "POST", body: { cwd, sessionId }, ...options, fallback: "Could not load commands.",
  })).commands;

export const saveDefaults = async (model: string | undefined, thinkingLevel: ThinkingLevel, options?: RequestOptions) =>
  (await call("/api/settings/defaults", Schema.Struct({ defaults: SessionDefaults }), {
    method: "PUT", body: { model, thinkingLevel }, ...options, fallback: "Could not save defaults. Try again.",
  })).defaults;

// Settings

export const oauthProviders = async (options?: RequestOptions) =>
  (await call("/api/oauth-providers", Schema.Struct({ providers: Schema.Array(OAuthProvider) }), { ...options, fallback: "Could not load providers." })).providers;

export const providerLogout = async (provider: string, options?: RequestOptions) => {
  await call("/api/provider-logout", Ok, { method: "POST", body: { provider }, ...options, fallback: "Could not sign out. Try again." });
};

/** Each sign-in request answers with the current attempt, or null when none exists. */
export type ProviderLoginRequest =
  | { method: "GET" }
  | { method: "POST"; body: { provider: string } }
  | { method: "PUT"; body: { id: string; promptId: string; value: string } }
  | { method: "DELETE"; body: { id: string } };

export const providerLogin = async (request: ProviderLoginRequest = { method: "GET" }, options?: RequestOptions) =>
  (await call("/api/provider-login", Schema.Struct({ state: Schema.NullOr(ProviderLoginState) }), {
    ...request, ...options, fallback: "Could not complete sign-in.",
  })).state;

export type RadiusSetupAction = "configure-mcp" | "install-web-search" | "remove-mcp" | "uninstall-web-search";

export const radiusSetup = async (action?: { action: RadiusSetupAction; removalKey?: string }, options?: RequestOptions) =>
  (await call("/api/settings/radius", Schema.Struct({ state: RadiusSetupState }), {
    ...(action ? { method: "POST", body: action } : {}), ...options, fallback: "Could not load Radius setup.",
  })).state;
