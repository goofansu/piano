import { Schema } from "effect";
import {
  type Endpoint,
  Endpoints,
  type IdParam,
  type Json,
  readRefusal,
  type SignInEndpoints,
  WRITTEN_PATHS_LIMIT,
} from "../../../shared/http.ts";
import type { McpSetupRequest } from "../../../shared/mcp.ts";
import type { RadiusSetupAction } from "../../../shared/radius.ts";
import {
  type ChangesScope,
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
export const listUserSkills = (options?: RequestOptions) =>
  call(Endpoints.skills.list, {}, options);
export const createUserSkill = (body: import("../../../shared/skills.ts").UserSkillCreate) =>
  call(Endpoints.skills.create, { body });
export const removeUserSkill = (name: string) => call(Endpoints.skills.remove, { body: { name } });
export const testWebhook = (id: string) => call(Endpoints.testWebhook, { body: { id } });
export const listPrompts = (options?: RequestOptions) => call(Endpoints.prompts.list, {}, options);
export const createPrompt = (body: import("../../../shared/prompts.ts").PromptCreate) =>
  call(Endpoints.prompts.create, { body });
export const removePrompt = (name: string) => call(Endpoints.prompts.remove, { body: { name } });

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
  const { method, noStore, fallback, path } = endpoint;
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
  const json: unknown = await (
    response.ok && readSuccess ? readSuccess(response) : response.json()
  ).catch((error) => {
    if (signal?.aborted) throw error;
    return undefined;
  });
  if (!response.ok) {
    const { error, field } = readRefusal(json, failure(response.status));
    throw new ApiError(error, response.status, field);
  }
  const decoded = Schema.decodeUnknownExit(endpoint.response)(json);
  if (decoded._tag === "Failure") throw new ApiError(failure(response.status), response.status);
  return decoded.value;
}

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
    } catch {}
  }
  return undefined;
}

export const sessionChanges = (
  workspaceId: string,
  sessionId: string,
  scope: ChangesScope | undefined,
  options?: RequestOptions,
) =>
  call(
    Endpoints.sessionChanges,
    { query: { workspaceId, sessionId }, body: scope ? { scope } : {} },
    options,
  );

export const sessionChangedFile = (
  workspaceId: string,
  sessionId: string,
  body: { path: string; scope: ChangesScope },
  options?: RequestOptions,
) => call(Endpoints.sessionChangedFile, { query: { workspaceId, sessionId }, body }, options);

export const setSessionChangesScope = (
  workspaceId: string,
  sessionId: string,
  scope: ChangesScope | null,
  options?: RequestOptions,
) =>
  call(
    Endpoints.setSessionChangesScope,
    { query: { workspaceId, sessionId }, body: { scope } },
    options,
  );

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

export const shareSession = (workspaceId: string, sessionId: string, options?: RequestOptions) =>
  call(
    Endpoints.shareSession,
    { query: { workspaceId, sessionId }, body: { confirmed: true } },
    options,
  );

export const sessionPullRequest = (
  workspaceId: string,
  sessionId: string,
  action: SessionPullRequestAction | undefined,
  options?: RequestOptions,
) =>
  action
    ? call(
        Endpoints.changeSessionPullRequest,
        { query: { workspaceId, sessionId }, body: action },
        options,
      )
    : call(Endpoints.sessionPullRequest, { query: { workspaceId, sessionId } }, options);

export const slashCommands = async (cwd: string, options?: RequestOptions) =>
  (await call(Endpoints.slashCommands, { body: { cwd } }, options)).commands;

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
): Promise<void> => {
  await call(Endpoints.saveDefaults, { body: { model, thinkingLevel } }, options);
};

export const oauthProviders = async (options?: RequestOptions) =>
  (await call(Endpoints.oauthProviders, {}, options)).providers;

export const providerLogout = async (provider: string, options?: RequestOptions) => {
  await call(Endpoints.providerLogout, { body: { provider } }, options);
};

export type SignInRequest =
  | { method: "GET" }
  | { method: "POST"; body: SignInEndpoints["start"]["body"]["Type"] }
  | { method: "PUT"; body: SignInEndpoints["answer"]["body"]["Type"] }
  | { method: "DELETE"; body: SignInEndpoints["cancel"]["body"]["Type"] };

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

export const providerApiKeys = async (options?: RequestOptions) =>
  (await call(Endpoints.providerApiKeys, {}, options)).providers;

export const changeProviderApiKey = async (
  body: typeof Endpoints.changeProviderApiKey.body.Type,
) => {
  await call(Endpoints.changeProviderApiKey, { body });
};

export const voiceInput = (options?: RequestOptions) => call(Endpoints.voiceInput, {}, options);
export const saveVoiceInput = (body: typeof Endpoints.saveVoiceInput.body.Type) =>
  call(Endpoints.saveVoiceInput, { body });
export const transcribe = (body: typeof Endpoints.transcribe.body.Type, options?: RequestOptions) =>
  call(Endpoints.transcribe, { body }, options);

export const providerLogin = signInApi(Endpoints.providerLogin);
export const mcpLogin = signInApi(Endpoints.mcpLogin);

export const mcpSetup = async (options?: RequestOptions) =>
  (await call(Endpoints.mcpSetup, {}, options)).state;
export const changeMcpSetup = (request: McpSetupRequest) =>
  call(Endpoints.changeMcpSetup, { body: request });

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
