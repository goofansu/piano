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
import {
  type Endpoint,
  Endpoints,
  type IdParam,
  type Json,
  type SignInEndpoints,
  WRITTEN_PATHS_LIMIT,
} from "../../../shared/http.ts";
import type { McpSetupRequest } from "../../../shared/mcp.ts";
import type { RadiusSetupAction } from "../../../shared/radius.ts";
import {
  type SessionPullRequestAction,
  sameWorkspace,
  type ThinkingLevel,
  type Workspace,
  type WorkspaceWrittenFiles,
  type WrittenFile,
} from "../../../shared/wire.ts";

export type { RadiusSetupAction };
export const listWebhooks = (options?: RequestOptions) => call(Endpoints.webhooks, {}, options);
export const saveWebhook = (body: import("../../../shared/webhooks.ts").WebhookSave) =>
  call(Endpoints.saveWebhook, { body });
export const removeWebhook = (id: string) => call(Endpoints.removeWebhook, { body: { id } });
export const testWebhook = (id: string) => call(Endpoints.testWebhook, { body: { id } });

/**
 * Every failed request: the server's own `error` message when it sent one, otherwise the
 * endpoint's fallback, and the form `field` the server said it belongs to. `status` is 0 when no
 * response arrived. Aborts are rethrown unchanged.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly field: string | undefined;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** What a call sends: the endpoint's ID parameters and, when it has one, its body. */
type Input<Q extends IdParam, B extends Json | undefined> = ([Q] extends [never]
  ? unknown
  : { readonly query: Readonly<Record<Q, string>> }) &
  (B extends Json ? { readonly body: B["Type"] } : unknown);

async function call<Q extends IdParam, B extends Json | undefined, R extends Json>(
  endpoint: Endpoint<Q, B, R>,
  input: Input<Q, B>,
  { signal }: RequestOptions = {},
  readSuccess?: (response: Response) => Promise<unknown>,
): Promise<R["Type"]> {
  const { method, path, noStore, fallback } = endpoint;
  const { query, body } = input as { query?: Record<string, string>; body?: unknown };
  const failure = (status: number) => (typeof fallback === "string" ? fallback : fallback(status));
  let response: Response;
  try {
    response = await fetch(query ? `${path}?${new URLSearchParams(query)}` : path, {
      method,
      signal,
      ...(noStore ? { cache: "no-store" as const } : {}),
      ...(endpoint.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(failure(0), 0);
  }
  // A proxy or crashed server may answer with something other than JSON.
  const json: unknown = await (response.ok && readSuccess
    ? readSuccess(response)
    : response.json()
  ).catch((error) => {
    if (signal?.aborted) throw error;
    return undefined;
  });
  if (!response.ok) {
    const message =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof json.error === "string" &&
      json.error
        ? json.error
        : failure(response.status);
    const field =
      json && typeof json === "object" && "field" in json && typeof json.field === "string"
        ? json.field
        : undefined;
    throw new ApiError(message, response.status, field);
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

export const workspaceFile = (workspaceId: string, path: string, options?: RequestOptions) =>
  call(
    Endpoints.workspaceFile,
    { query: { workspaceId }, body: { path } },
    options,
    async (response) => {
      if (!response.headers.get("content-type")?.startsWith("multipart/form-data"))
        return response.json();
      const form = await response.formData();
      const metadata = form.get("metadata"),
        file = form.get("file");
      if (typeof metadata !== "string" || !(file instanceof Blob))
        throw new Error("Invalid file reply.");
      return { ...JSON.parse(metadata), bytes: new Uint8Array(await file.arrayBuffer()) };
    },
  );

/** The exact file, for saving. Its name comes from the server's attachment header, else the path. */
export const workspaceFileDownload = (
  workspaceId: string,
  path: string,
  options?: RequestOptions,
) =>
  call(
    Endpoints.workspaceFileDownload,
    { query: { workspaceId }, body: { path } },
    options,
    async (response) => ({
      name:
        attachmentName(response.headers.get("content-disposition")) ??
        path.slice(path.lastIndexOf("/") + 1),
      mime:
        response.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream",
      bytes: new Uint8Array(await response.arrayBuffer()),
    }),
  );

function attachmentName(disposition: string | null): string | undefined {
  const exact = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (exact) {
    try {
      return decodeURIComponent(exact[1]);
    } catch {
      /* fall through to the path */
    }
  }
  return undefined;
}

// Live workspace changes

export const workspaceChanges = (workspaceId: string, options?: RequestOptions) =>
  call(Endpoints.workspaceChanges, { query: { workspaceId } }, options);

export const workspaceChangedFile = (workspaceId: string, path: string, options?: RequestOptions) =>
  call(Endpoints.workspaceChangedFile, { query: { workspaceId }, body: { path } }, options);

/**
 * Where each of `paths` stands in `workspace` (one `WrittenFile` per path, in order): one
 * observation however many paths are asked about. A request carries `WRITTEN_PATHS_LIMIT` paths,
 * so a longer list is read one batch at a time, in order, and the batches' files are joined here.
 * The read stops at the first abort, failure or error result rather than publishing the batches
 * before it. The answer carries the oldest `observedAt` it was built from: no part of it is fresher.
 *
 * Every reply must name `workspace`, by all of its identity — ID, path and folder (INV-07). A
 * reply that names another is as far outside the contract as a malformed one, so it fails the
 * same way `call` does, an `ApiError` carrying the reply's status, with the reason in its message.
 */
export const workspaceWrittenFiles = async (
  workspace: Workspace,
  paths: readonly string[],
  options?: RequestOptions,
): Promise<WorkspaceWrittenFiles> => {
  const files: WrittenFile[] = [];
  let first: WorkspaceWrittenFiles | undefined;
  for (let at = 0; at === 0 || at < paths.length; at += WRITTEN_PATHS_LIMIT) {
    options?.signal?.throwIfAborted();
    const answer = await call(
      Endpoints.workspaceWrittenFiles,
      {
        query: { workspaceId: workspace.id },
        body: { paths: paths.slice(at, at + WRITTEN_PATHS_LIMIT) },
      },
      options,
    );
    if (!sameWorkspace(workspace, answer.workspace))
      throw new ApiError(
        "Files answered for another workspace. Refresh folders and try again.",
        200,
      );
    first ??= answer;
    if (answer.result.status !== "ready") return answer;
    files.push(...answer.result.files);
  }
  return { workspace, observedAt: first!.observedAt, result: { status: "ready", files } };
};

// Session pull request

/** Reads always bypass the HTTP cache: GitHub facts are live. */
export const sessionPullRequest = (
  workspaceId: string,
  sessionId: string,
  action?: SessionPullRequestAction,
  options?: RequestOptions,
) =>
  action
    ? call(
        Endpoints.changeSessionPullRequest,
        { query: { workspaceId, sessionId }, body: action },
        options,
      )
    : call(Endpoints.sessionPullRequest, { query: { workspaceId, sessionId } }, options);

export const shareSession = (workspaceId: string, sessionId: string) =>
  call(Endpoints.shareSession, { query: { workspaceId, sessionId } });

// Composer

/** Before a session starts, from the directory's probe. */
export const slashCommands = async (cwd: string, options?: RequestOptions) =>
  (await call(Endpoints.slashCommands, { body: { cwd } }, options)).commands;

/** From the running session's own child; fails with 409 once it has stopped. */
export const sessionCommands = async (
  workspaceId: string,
  sessionId: string,
  options?: RequestOptions,
) =>
  (await call(Endpoints.sessionCommands, { query: { workspaceId, sessionId } }, options)).commands;

export const saveDefaults = async (
  model: string | undefined,
  thinkingLevel: ThinkingLevel,
  options?: RequestOptions,
) => (await call(Endpoints.saveDefaults, { body: { model, thinkingLevel } }, options)).defaults;

// Settings

export const oauthProviders = async (options?: RequestOptions) =>
  (await call(Endpoints.oauthProviders, {}, options)).providers;

export const providerLogout = async (provider: string, options?: RequestOptions) => {
  await call(Endpoints.providerLogout, { body: { provider } }, options);
};

/** Each sign-in request answers with the current attempt, or null when none exists. */
export type SignInRequest =
  | { method: "GET" }
  | { method: "POST"; body: SignInEndpoints["start"]["body"]["Type"] }
  | { method: "PUT"; body: SignInEndpoints["answer"]["body"]["Type"] }
  | { method: "DELETE"; body: SignInEndpoints["cancel"]["body"]["Type"] };

/** One sign-in lane's requests, the shape both sign-in dialogs drive. */
export const signInApi =
  (endpoints: SignInEndpoints) =>
  async (request: SignInRequest = { method: "GET" }, options?: RequestOptions) => {
    switch (request.method) {
      case "GET":
        return (await call(endpoints.state, {}, options)).state;
      case "POST":
        return (await call(endpoints.start, request, options)).state;
      case "PUT":
        return (await call(endpoints.answer, request, options)).state;
      case "DELETE":
        return (await call(endpoints.cancel, request, options)).state;
    }
  };

export const providerLogin = signInApi(Endpoints.providerLogin);
/** The same sign-in attempt as providers', run by Pi's MCP OAuth for a catalog server. */
export const mcpLogin = signInApi(Endpoints.mcpLogin);

export const mcpSetup = async (request?: McpSetupRequest, options?: RequestOptions) =>
  (request
    ? await call(Endpoints.changeMcpSetup, { body: request }, options)
    : await call(Endpoints.mcpSetup, {}, options)
  ).state;

export const radiusSetup = async (
  action?: { action: RadiusSetupAction; removalKey?: string },
  options?: RequestOptions,
) =>
  (action
    ? await call(
        Endpoints.changeRadiusSetup,
        { body: action as typeof Endpoints.changeRadiusSetup.body.Type },
        options,
      )
    : await call(Endpoints.radiusSetup, {}, options)
  ).state;
