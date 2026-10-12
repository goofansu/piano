import { mkdirSync } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Cause, Data, Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { type Endpoint, Endpoints, type IdParam, type Json } from "../shared/http.ts";
import type { RadiusSetupState } from "../shared/radius.ts";
import type { DirListing, Workspace } from "../shared/wire.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { errorText } from "./ErrorText.ts";
import { getImagePreview } from "./ImagePreviews.ts";
import { McpSetup, type McpSetupError } from "./McpSetup.ts";
import { AllowedOrigins } from "./OriginPolicy.ts";
import { directoryPath } from "./PiEnv.ts";
import { PiSettings } from "./PiSettings.ts";
import { ProviderLogin } from "./ProviderLogin.ts";
import { RadiusSetup, type RadiusSetupError } from "./RadiusSetup.ts";
import { Registry, type SessionEntry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { SessionPullRequests } from "./SessionPullRequests.ts";
import { SidebarView } from "./SidebarView.ts";
import type { SignInError, SignInState } from "./SignInAttempts.ts";
import { WorkspaceChanges } from "./WorkspaceChanges.ts";
import { WorkspaceRevisions } from "./WorkspaceRevisions.ts";
import { gitHeadSubject, gitTopLevel } from "./Worktrees.ts";
import { handleSocket } from "./WsClient.ts";

/** Subdirectories for the folder picker, with git HEAD subjects for checkouts (as Shelley does). Hidden folders are skipped. */
const listDirectory = Effect.fn("Router.listDirectory")(function* (raw: string) {
    const path = directoryPath(raw || "~");
    const directory = yield* Effect.tryPromise({ try: () => stat(path), catch: error =>
      (error as NodeJS.ErrnoException).code === "ENOENT" ? new Error(`No such directory: ${path}`) : error });
    if (!directory.isDirectory()) return yield* Effect.fail(new Error(`${path} is a file, not a directory`));
    const children = (yield* Effect.tryPromise({ try: () => readdir(path), catch: error => error })).filter(name => !name.startsWith("."));
    // Follow directory symlinks as before, with bounded IO and no synchronous filesystem waits.
    const directories = yield* Effect.forEach(children, name =>
      Effect.tryPromise(() => stat(join(path, name))).pipe(
        Effect.map(entry => entry.isDirectory()), Effect.orElseSucceed(() => false)), { concurrency: 8 });
    const names = children.filter((_, i) => directories[i]);
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const entries = yield* Effect.forEach(
      names,
      (name) =>
        Effect.gen(function* () {
          const full = join(path, name);
          const hasGit = yield* Effect.tryPromise(() => access(join(full, ".git"))).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
          const gitSubject = hasGit ? yield* gitHeadSubject(full) : undefined;
          return { name, path: full, gitSubject: gitSubject || undefined };
        }),
      { concurrency: 8 },
    );
    const gitRoot = yield* gitTopLevel(path);
    const gitSubject = gitRoot ? yield* gitHeadSubject(path) : undefined;
    const parent = dirname(path);
    const listing: DirListing = {
      path,
      parent: parent === path ? null : parent,
      home: homedir(),
      gitSubject: gitSubject || undefined,
      gitRoot: gitRoot || undefined,
      entries,
    };
    return listing;
  });

/** A failed request as the browser sees it: a status and the `error` message it shows. */
class ApiFailure extends Data.TaggedError("ApiFailure")<{ readonly status: number; readonly error: string }> {}

const fail = (status: number, error: string) => Effect.fail(new ApiFailure({ status, error }));

/** Every other failure becomes `status` with its own `detail`, or `fallback` when it has none. */
const failAs = (status: number, fallback: string | ((error: unknown) => string)) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.catchCause(cause => {
    const error = Cause.squash(cause);
    if (error instanceof ApiFailure) return Effect.fail(error);
    return fail(status, typeof fallback === "string" ? fallback : fallback(error));
  }));

const detailOr = (fallback: string) => (error: unknown) => errorText(error, fallback);

/** What a handler receives: the decoded body, and the registered workspace and session its IDs name. */
type Input<Q extends IdParam, B extends Json | undefined> =
  & (B extends Json ? { readonly body: B["Type"] } : unknown)
  & ("workspaceId" extends Q ? { readonly workspace: Workspace } : unknown)
  & ("sessionId" extends Q ? { readonly session: SessionEntry } : unknown);

const respond = (body: unknown, status: number, { noStore = false, redact = true } = {}) =>
  HttpServerResponse.text(JSON.stringify(redact ? projectDisplay(body) : body, null, 2), {
    status, contentType: "application/json", ...(noStore ? { headers: { "cache-control": "no-store" } } : {}),
  });

/**
 * One route per endpoint of shared/http.ts. IDs are resolved and the body decoded before the
 * handler runs; its result leaves through the response Schema, so the server cannot answer
 * outside the contract the browser decodes.
 */
const route = (router: HttpRouter.HttpRouter) => <Q extends IdParam, B extends Json | undefined, R extends Json, Req>(
  endpoint: Endpoint<Q, B, R>,
  handler: (input: Input<Q, B>) => Effect.Effect<R["Type"], ApiFailure, Req>,
  /** Sign-in and Radius setup state carry no transcript content and leave unprojected, so codes and URLs reach the user intact. */
  options: { readonly redact?: boolean } = {},
) => router.add(endpoint.method, endpoint.path, Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const input: Record<string, unknown> = {};
  if (endpoint.query.length > 0) {
    const params = new URL(request.url, "http://localhost").searchParams;
    const workspaceId = params.get("workspaceId"), sessionId = params.get("sessionId");
    const wantsSession = (endpoint.query as ReadonlyArray<IdParam>).includes("sessionId");
    if (!workspaceId || (wantsSession && !sessionId)) return yield* fail(400, wantsSession ? "Workspace and session IDs are required." : "Workspace ID is required.");
    const registry = yield* Registry;
    const found = yield* (wantsSession && sessionId ? registry.sessionIn(workspaceId, sessionId) : Effect.map(registry.workspace(workspaceId), workspace => ({ workspace })))
      .pipe(Effect.catchTag("RegistryLookupError", error => fail(404, error.detail)));
    Object.assign(input, found);
  }
  if (endpoint.body) {
    const text = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
    const body = Schema.decodeUnknownExit(Schema.fromJsonString(endpoint.body as Json))(text);
    if (body._tag === "Failure") return yield* fail(400, endpoint.invalid);
    input.body = body.value;
  }
  const result = yield* handler(input as Input<Q, B>);
  const encoded = Schema.encodeUnknownExit(endpoint.response)(result);
  if (encoded._tag === "Failure") {
    yield* Effect.logError(`${endpoint.method} ${endpoint.path} answered outside its contract`, encoded.cause);
    return yield* fail(500, "The server answered outside its contract. Inspect the server log.");
  }
  return respond(encoded.value, 200, { noStore: endpoint.noStore, redact: options.redact });
}).pipe(Effect.catchTag("ApiFailure", failure => Effect.succeed(respond({ error: failure.error }, failure.status)))));

export const AppRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const allowedOrigins = yield* AllowedOrigins;
    // INV-11: run before body decoding, side effects, and WebSocket upgrade/dispatch.
    yield* router.addGlobalMiddleware((handler) => Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = new URL(request.url, "http://localhost").pathname;
      if (path === "/ws" || request.headers.upgrade !== undefined || !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        const origin = request.headers.origin;
        if (!origin || !allowedOrigins.has(origin)) {
          return HttpServerResponse.text("Request origin is not allowed.", { status: 403 });
        }
      }
      return yield* handler;
    }));
    yield* router.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const socket = yield* request.upgrade;
        yield* handleSocket(socket);
        return HttpServerResponse.empty();
      }).pipe(Effect.scoped),
    );

    const serve = route(router);

    yield* serve(Endpoints.listDirectory, ({ body }) => {
      const raw = body.path ?? "~";
      // Answer with the failure's own message, never the Effect cause wrapper.
      return listDirectory(raw).pipe(failAs(400, e => e instanceof Error ? (e as NodeJS.ErrnoException).code === "EACCES" ? `Cannot read ${raw}: permission denied` : e.message : String(e)));
    });

    yield* serve(Endpoints.makeDirectory, ({ body }) => Effect.gen(function* () {
      const path = directoryPath(body.path);
      if (!body.path || path === "/") return yield* fail(400, Endpoints.makeDirectory.invalid);
      yield* Effect.try({ try: () => mkdirSync(path, { recursive: true }), catch: e => new ApiFailure({ status: 400, error: e instanceof Error ? e.message : String(e) }) });
      return { path };
    }));

    yield* serve(Endpoints.folders, () => Effect.map(Effect.flatMap(SidebarView, view => view.fresh), ({ folders }) => ({ folders })));

    yield* serve(Endpoints.workspaceChanges, ({ workspace }) => Effect.flatMap(WorkspaceChanges, changes => changes.preview(workspace)));
    yield* serve(Endpoints.workspaceChangedFile, ({ workspace, body }) => Effect.flatMap(WorkspaceChanges, changes => changes.preview(workspace, body.path)));
    yield* serve(Endpoints.workspaceCapture, ({ workspace }) => Effect.flatMap(WorkspaceRevisions, revisions => revisions.capture(workspace)));

    const pullRequestFailure = failAs(400, detailOr("Invalid pull request request."));
    yield* serve(Endpoints.sessionPullRequest, ({ session }) =>
      Effect.flatMap(SessionPullRequests, prs => prs.get(session)).pipe(pullRequestFailure));
    yield* serve(Endpoints.changeSessionPullRequest, ({ session, body }) =>
      Effect.flatMap(SessionPullRequests, prs => prs.change(session, body)).pipe(pullRequestFailure));

    const commandsFailure = failAs(502, "Could not load commands. Reopen the suggestions to retry.");
    yield* serve(Endpoints.slashCommands, ({ body }) => Effect.gen(function* () {
      if (!body.cwd) return yield* fail(400, Endpoints.slashCommands.invalid);
      const facts = yield* DirectoryFacts;
      return { commands: yield* facts.commands(body.cwd) };
    }).pipe(Effect.catchTag("DirectoryCommandsError", error => fail(502, error.detail)), commandsFailure));
    // INV-02: discovery asks the running child and never opens a saved session or a second writer.
    yield* serve(Endpoints.sessionCommands, ({ session }) => Effect.gen(function* () {
      const running = yield* Effect.flatMap(SessionHosts, hosts => hosts.get(session.cwd, session.sessionId));
      if (!running) return yield* fail(409, "Session is no longer running. Reopen the suggestions.");
      const result = yield* running.act({ _tag: "commands" });
      if (result?._tag !== "commands") return yield* fail(502, "Command catalog unavailable.");
      return { commands: result.commands };
    }).pipe(commandsFailure));

    yield* serve(Endpoints.saveDefaults, ({ body }) =>
      Effect.flatMap(PiSettings, settings => settings.saveDefaults(body)).pipe(
        Effect.map(defaults => ({ defaults })),
        Effect.catchTag("PiSettingsError", error => fail(400, error.detail))));

    const radiusAction = (body: typeof Endpoints.changeRadiusSetup.body.Type) => Effect.flatMap(RadiusSetup, (setup): Effect.Effect<RadiusSetupState, RadiusSetupError> => {
      switch (body.action) {
        case "configure-mcp": return setup.configureMcp;
        case "install-web-search": return setup.installWebSearch;
        case "remove-mcp": return setup.removeMcp(body.removalKey);
        case "uninstall-web-search": return setup.uninstallWebSearch(body.removalKey);
      }
    });
    yield* serve(Endpoints.radiusSetup, () => Effect.flatMap(RadiusSetup, setup => setup.state).pipe(Effect.map(state => ({ state }))), { redact: false });
    yield* serve(Endpoints.changeRadiusSetup, ({ body }) => radiusAction(body).pipe(Effect.map(state => ({ state })), Effect.catchTag("RadiusSetupError", error => fail(409, error.detail))), { redact: false });

    const mcp = <A>(step: (setup: McpSetup["Service"]) => Effect.Effect<A, McpSetupError>) => Effect.flatMap(McpSetup, step).pipe(
      Effect.map(state => ({ state })), Effect.catchTag("McpSetupError", error => fail(409, error.detail)));
    yield* serve(Endpoints.mcpSetup, () => mcp(setup => setup.state), { redact: false });
    yield* serve(Endpoints.changeMcpSetup, ({ body }) => mcp(setup => setup.change(body)), { redact: false });

    yield* serve(Endpoints.oauthProviders, () =>
      Effect.flatMap(ProviderLogin, login => login.providers).pipe(Effect.map(providers => ({ providers })), failAs(502, "Could not load OAuth providers.")));

    // A refused sign-in request answers with its own detail; SignInAttempts keeps token responses out of it (INV-11).
    const signInFailure = <A, R>(effect: Effect.Effect<A, SignInError, R>) => effect.pipe(
      Effect.catchTag("SignInError", error => fail(409, error.detail)),
      failAs(409, "Sign-in request could not be completed. Resume the current sign-in or try again."));

    yield* serve(Endpoints.providerLogout, ({ body }) =>
      Effect.flatMap(ProviderLogin, login => login.signOut(body.provider)).pipe(Effect.as({ ok: true as const }), signInFailure));

    // Credential values and callback URLs travel only in bodies. This global
    // operation creates no session and owns no conversation history.
    const login = <R>(step: Effect.Effect<SignInState | null, SignInError, R>) => step.pipe(Effect.map(state => ({ state })), signInFailure);
    yield* serve(Endpoints.providerLoginState, () => login(Effect.flatMap(ProviderLogin, l => l.state)), { redact: false });
    yield* serve(Endpoints.startProviderLogin, ({ body }) => login(Effect.flatMap(ProviderLogin, l => l.start(body.provider))), { redact: false });
    yield* serve(Endpoints.answerProviderLogin, ({ body }) => login(Effect.flatMap(ProviderLogin, l => l.answer(body.id, body.promptId, body.value))), { redact: false });
    yield* serve(Endpoints.cancelProviderLogin, ({ body }) => login(Effect.flatMap(ProviderLogin, l => l.cancel(body.id))), { redact: false });
    yield* serve(Endpoints.mcpLoginState, () => login(Effect.flatMap(McpSetup, setup => setup.login)), { redact: false });
    yield* serve(Endpoints.startMcpLogin, ({ body }) => login(Effect.flatMap(McpSetup, setup => setup.startLogin(body.server))), { redact: false });
    yield* serve(Endpoints.answerMcpLogin, ({ body }) => login(Effect.flatMap(McpSetup, setup => setup.answerLogin(body.id, body.promptId, body.value))), { redact: false });
    yield* serve(Endpoints.cancelMcpLogin, ({ body }) => login(Effect.flatMap(McpSetup, setup => setup.cancelLogin(body.id))), { redact: false });

    // Image bytes, not JSON: outside the endpoint table. The ID is a content hash, never a path.
    yield* router.add("GET", "/api/image-previews/:id", Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = new URL(request.url, "http://localhost").pathname.split("/").pop() ?? "";
      const image = /^[a-f0-9]{64}$/.test(id) ? getImagePreview(id) : undefined;
      return image ? HttpServerResponse.uint8Array(image.bytes, { contentType: image.mimeType,
        headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } })
        : HttpServerResponse.empty({ status: 404 });
    }));
  }),
);
