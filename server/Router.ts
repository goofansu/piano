import { Cause, Data, Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import {
  type Endpoint,
  Endpoints,
  type IdParam,
  type Json,
  type RefusedStatus,
  type SignInEndpoints,
} from "../shared/http.ts";
import type { Workspace } from "../shared/wire.ts";
import { Directories } from "./Directories.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { ExeDev } from "./ExeDev.ts";
import { getImagePreview } from "./ImagePreviews.ts";
import { McpSetup } from "./McpSetup.ts";
import { Notifications } from "./Notifications.ts";
import { AllowedOrigins } from "./OriginPolicy.ts";
import { PiSettings } from "./PiSettings.ts";
import { ProviderLogin } from "./ProviderLogin.ts";
import { RadiusSetup } from "./RadiusSetup.ts";
import { Registry, type SessionEntry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { SessionPullRequests } from "./SessionPullRequests.ts";
import { SessionSharing } from "./SessionSharing.ts";
import { SidebarView } from "./SidebarView.ts";
import type { SignInError, SignInLane, SignInState } from "./SignInAttempts.ts";
import { WorkspaceChanges } from "./WorkspaceChanges.ts";
import { downloadWorkspaceFile, readWorkspaceFile } from "./WorkspaceFiles.ts";
import { handleSocket } from "./WsClient.ts";

/** A failed request as the browser sees it: a status and the `error` message it shows. */
class ApiFailure extends Data.TaggedError("ApiFailure")<{
  readonly status: number;
  readonly error: string;
}> {}

const fail = (status: number, error: string) => Effect.fail(new ApiFailure({ status, error }));

/** A service's refusal: a tagged error whose `detail` is written for people. Its endpoint
 * declares the status (`refused`). SignInAttempts keeps token responses out of sign-in details (INV-11). */
interface Refusal {
  readonly _tag: string;
  readonly detail: string;
}

const isRefusal = (error: unknown): error is Refusal =>
  !!error &&
  typeof error === "object" &&
  typeof (error as Partial<Refusal>)._tag === "string" &&
  typeof (error as Partial<Refusal>).detail === "string";

/** The failure a request ends with: a handler's own ApiFailure, a refusal at the endpoint's
 * status, or anything else (a defect included) as a logged 500 with the endpoint's fallback,
 * never its own message. */
const failure = (endpoint: Endpoint, cause: Cause.Cause<unknown>) => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  if (error instanceof ApiFailure) return Effect.succeed(error);
  if (endpoint.refused && isRefusal(error))
    return Effect.succeed(new ApiFailure({ status: endpoint.refused, error: error.detail }));
  const { fallback } = endpoint;
  return Effect.logError(`${endpoint.method} ${endpoint.path} failed unexpectedly`, cause).pipe(
    Effect.as(
      new ApiFailure({
        status: 500,
        error: typeof fallback === "string" ? fallback : fallback(500),
      }),
    ),
  );
};

/** What a handler receives: the decoded body, and the registered workspace and session its IDs name. */
type Input<Q extends IdParam, B extends Json | undefined> = (B extends Json
  ? { readonly body: B["Type"] }
  : unknown) &
  ("workspaceId" extends Q ? { readonly workspace: Workspace } : unknown) &
  ("sessionId" extends Q ? { readonly session: SessionEntry } : unknown);

/** `attachment` with an ASCII fallback name and the exact name RFC 5987-encoded. */
const attachment = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

const respond = (body: unknown, status: number, { noStore = false, redact = true } = {}) =>
  HttpServerResponse.text(JSON.stringify(redact ? projectDisplay(body) : body, null, 2), {
    status,
    contentType: "application/json",
    ...(noStore ? { headers: { "cache-control": "no-store" } } : {}),
  });

/**
 * One route per endpoint of shared/http.ts. IDs are resolved and the body decoded before the
 * handler runs; its result leaves through the response Schema, so the server cannot answer
 * outside the contract the browser decodes.
 */
const route =
  (router: HttpRouter.HttpRouter) =>
  <
    Q extends IdParam,
    B extends Json | undefined,
    R extends Json,
    F extends RefusedStatus | undefined,
    Req,
  >(
    endpoint: Endpoint<Q, B, R, F>,
    /** May fail with a refusal only when the endpoint declares a status for it. */
    handler: (
      input: Input<Q, B>,
    ) => Effect.Effect<
      R["Type"],
      ApiFailure | ([F] extends [RefusedStatus] ? Refusal : never),
      Req
    >,
    respondWith?: (result: R["Type"]) => HttpServerResponse.HttpServerResponse,
  ) =>
    router.add(
      endpoint.method,
      endpoint.path,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const input: Record<string, unknown> = {};
        if (endpoint.query.length > 0) {
          const params = new URL(request.url, "http://localhost").searchParams;
          const workspaceId = params.get("workspaceId"),
            sessionId = params.get("sessionId");
          const wantsSession = (endpoint.query as ReadonlyArray<IdParam>).includes("sessionId");
          if (!workspaceId || (wantsSession && !sessionId))
            return yield* fail(
              400,
              wantsSession
                ? "Workspace and session IDs are required."
                : "Workspace ID is required.",
            );
          const registry = yield* Registry;
          const found = yield* (
            wantsSession && sessionId
              ? registry.sessionIn(workspaceId, sessionId)
              : Effect.map(registry.workspace(workspaceId), (workspace) => ({ workspace }))
          ).pipe(Effect.catchTag("RegistryLookupError", (error) => fail(404, error.detail)));
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
          yield* Effect.logError(
            `${endpoint.method} ${endpoint.path} answered outside its contract`,
            encoded.cause,
          );
          return yield* fail(
            500,
            "The server answered outside its contract. Inspect the server log.",
          );
        }
        if (respondWith) return respondWith(result);
        return respond(encoded.value, 200, { noStore: endpoint.noStore, redact: endpoint.redact });
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.map(failure(endpoint, cause), ({ status, error }) =>
                respond({ error }, status),
              ),
        ),
      ),
    );

export const AppRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const allowedOrigins = yield* AllowedOrigins;
    // INV-11: run before body decoding, side effects, and WebSocket upgrade/dispatch.
    yield* router.addGlobalMiddleware((handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "http://localhost").pathname;
        if (
          path === "/ws" ||
          request.headers.upgrade !== undefined ||
          !["GET", "HEAD", "OPTIONS"].includes(request.method)
        ) {
          const origin = request.headers.origin;
          if (!origin || !allowedOrigins.has(origin)) {
            return HttpServerResponse.text("Request origin is not allowed.", { status: 403 });
          }
        }
        return yield* handler;
      }),
    );
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

    yield* serve(Endpoints.listDirectory, ({ body }) => Directories.list(body.path ?? "~"));

    yield* serve(Endpoints.makeDirectory, ({ body }) =>
      Effect.map(Directories.make(body.path), (path) => ({ path })),
    );

    yield* serve(Endpoints.folders, () =>
      Effect.map(
        Effect.flatMap(SidebarView, (view) => view.fresh),
        ({ folders }) => ({ folders }),
      ),
    );

    yield* serve(
      Endpoints.workspaceFile,
      ({ workspace, body }) => readWorkspaceFile(workspace, body.path),
      (result) => {
        if (!("bytes" in result)) return respond(result, 200, { noStore: true });
        const { bytes, ...metadata } = result;
        const form = new FormData();
        form.set("metadata", JSON.stringify(projectDisplay(metadata)));
        form.set("file", new Blob([new Uint8Array(bytes)], { type: result.mime }), "file");
        return HttpServerResponse.formData(form, {
          headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
        });
      },
    );
    yield* serve(
      Endpoints.workspaceFileDownload,
      ({ workspace, body }) => downloadWorkspaceFile(workspace, body.path),
      // The file itself: an attachment of exact bytes, outside the display redaction by design.
      ({ name, mime, bytes }) =>
        HttpServerResponse.uint8Array(new Uint8Array(bytes), {
          contentType: mime.startsWith("text/") ? `${mime}; charset=utf-8` : mime,
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "content-disposition": attachment(name),
          },
        }),
    );
    yield* serve(Endpoints.workspaceChanges, ({ workspace }) =>
      Effect.flatMap(WorkspaceChanges, (changes) => changes.preview(workspace)),
    );
    yield* serve(Endpoints.workspaceChangedFile, ({ workspace, body }) =>
      Effect.flatMap(WorkspaceChanges, (changes) => changes.preview(workspace, body.path)),
    );
    yield* serve(Endpoints.workspaceIgnoredFiles, ({ workspace, body }) =>
      Effect.flatMap(WorkspaceChanges, (changes) => changes.ignored(workspace, body.paths)),
    );

    yield* serve(Endpoints.sessionPullRequest, ({ session }) =>
      Effect.flatMap(SessionPullRequests, (prs) => prs.get(session)),
    );
    yield* serve(Endpoints.changeSessionPullRequest, ({ session, body }) =>
      Effect.flatMap(SessionPullRequests, (prs) => prs.change(session, body)),
    );

    yield* serve(Endpoints.shareSession, ({ session }) =>
      Effect.flatMap(SessionSharing, (sharing) => sharing.share(session)),
    );

    yield* serve(Endpoints.slashCommands, ({ body }) =>
      Effect.flatMap(DirectoryFacts, (facts) => facts.commands(body.cwd)).pipe(
        Effect.map((commands) => ({ commands })),
      ),
    );
    yield* serve(Endpoints.sessionCommands, ({ session }) =>
      Effect.flatMap(SessionHosts, (hosts) => hosts.commands(session.cwd, session.sessionId)).pipe(
        Effect.map((commands) => ({ commands })),
      ),
    );

    yield* serve(Endpoints.saveDefaults, ({ body }) =>
      Effect.flatMap(PiSettings, (settings) => settings.saveDefaults(body)).pipe(
        Effect.map((defaults) => ({ defaults })),
      ),
    );

    yield* serve(Endpoints.radiusSetup, () =>
      Effect.flatMap(RadiusSetup, (setup) => setup.state).pipe(Effect.map((state) => ({ state }))),
    );
    yield* serve(Endpoints.changeRadiusSetup, ({ body }) =>
      Effect.flatMap(RadiusSetup, (setup) => setup.change(body)).pipe(
        Effect.map((state) => ({ state })),
      ),
    );

    yield* serve(Endpoints.exeDevEnvironment, () =>
      Effect.flatMap(ExeDev, (exe) => exe.detected).pipe(Effect.map((detected) => ({ detected }))),
    );
    yield* serve(Endpoints.integrationsSettings, () =>
      Effect.flatMap(Notifications, (notifications) => notifications.state()),
    );
    yield* serve(Endpoints.changeIntegrationsSettings, ({ body }) =>
      Effect.flatMap(Notifications, (notifications) => notifications.change(body)),
    );

    yield* serve(Endpoints.mcpSetup, () =>
      Effect.flatMap(McpSetup, (setup) => setup.state).pipe(Effect.map((state) => ({ state }))),
    );
    yield* serve(Endpoints.changeMcpSetup, ({ body }) =>
      Effect.flatMap(McpSetup, (setup) => setup.change(body)).pipe(
        Effect.map((state) => ({ state })),
      ),
    );

    yield* serve(Endpoints.oauthProviders, () =>
      Effect.flatMap(ProviderLogin, (login) => login.providers).pipe(
        Effect.map((providers) => ({ providers })),
      ),
    );

    yield* serve(Endpoints.providerLogout, ({ body }) =>
      Effect.flatMap(ProviderLogin, (login) => login.signOut(body.provider)).pipe(
        Effect.as({ ok: true as const }),
      ),
    );

    // One lane's four routes. Credential values and callback URLs travel only in bodies. This
    // global operation creates no session and owns no conversation history.
    const serveSignIn = Effect.fnUntraced(function* <R>(
      endpoints: SignInEndpoints,
      lane: Effect.Effect<SignInLane, never, R>,
    ) {
      const step = (
        request: (lane: SignInLane) => Effect.Effect<SignInState | null, SignInError>,
      ) => Effect.flatMap(lane, request).pipe(Effect.map((state) => ({ state })));
      yield* serve(endpoints.state, () => step((l) => l.state));
      yield* serve(endpoints.start, ({ body }) => step((l) => l.start(body.provider)));
      yield* serve(endpoints.answer, ({ body }) =>
        step((l) => l.answer(body.id, body.promptId, body.value)),
      );
      yield* serve(endpoints.cancel, ({ body }) => step((l) => l.cancel(body.id)));
    });
    yield* serveSignIn(
      Endpoints.providerLogin,
      Effect.map(ProviderLogin, (login) => login.signIn),
    );
    yield* serveSignIn(
      Endpoints.mcpLogin,
      Effect.map(McpSetup, (setup) => setup.signIn),
    );

    // Image bytes, not JSON: outside the endpoint table. The ID is a content hash, never a path.
    yield* router.add(
      "GET",
      "/api/image-previews/:id",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const id = new URL(request.url, "http://localhost").pathname.split("/").pop() ?? "";
        const image = /^[a-f0-9]{64}$/.test(id) ? getImagePreview(id) : undefined;
        return image
          ? HttpServerResponse.uint8Array(image.bytes, {
              contentType: image.mimeType,
              headers: {
                "cache-control": "private, no-store",
                "x-content-type-options": "nosniff",
              },
            })
          : HttpServerResponse.empty({ status: 404 });
      }),
    );
  }),
);
