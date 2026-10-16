import { Clock, Effect, Fiber, Semaphore } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { type ApiAccepted, ApiEndpoints } from "../shared/api.ts";
import { snapshotStatus } from "./ApiStatus.ts";
import { Registry } from "./Registry.ts";
import { fail, route } from "./Router.ts";
import { SessionHosts } from "./SessionHosts.ts";

export const ApiRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const hosts = yield* SessionHosts;
    const scope = yield* Effect.scope;
    type Failure = Effect.Error<ReturnType<typeof fail>>;
    const requests = new Map<
      string,
      { expires: number; fiber: Fiber.Fiber<ApiAccepted, Failure> }
    >();
    const lock = yield* Semaphore.make(1);
    // Cache the in-flight operation too: simultaneous retries must not create two sessions.
    // Its lifetime is the services/router scope, never the HTTP request's scope.
    const accept = Effect.fn("ApiRouter.accept")(function* (
      requestId: string | undefined,
      operation: Effect.Effect<ApiAccepted, Failure>,
    ) {
      const fiber = yield* Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          for (const [id, entry] of requests)
            if (entry.expires <= now && entry.fiber.pollUnsafe()) requests.delete(id);
          if (requestId !== undefined) {
            const previous = requests.get(requestId);
            if (previous) return previous.fiber;
            if (requests.size >= 1000) {
              const oldest = [...requests].find(([, entry]) => entry.fiber.pollUnsafe());
              if (!oldest)
                return yield* fail(409, "Request deduplication is busy. Try again later.");
              requests.delete(oldest[0]);
            }
          }
          const fiber = yield* operation.pipe(Effect.forkIn(scope));
          if (requestId !== undefined)
            requests.set(requestId, { expires: now + 10 * 60_000, fiber });
          return fiber;
        }),
      );
      return yield* Fiber.join(fiber);
    });
    yield* router.addGlobalMiddleware((handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (request.headers.origin !== undefined)
          return HttpServerResponse.jsonUnsafe(
            { error: "Origin not allowed on API." },
            { status: 403 },
          );
        const path = new URL(request.url, "http://localhost").pathname;
        if (
          !Object.values(ApiEndpoints).some((e) => e.path === path && e.method === request.method)
        )
          return HttpServerResponse.jsonUnsafe({ error: "Not found." }, { status: 404 });
        return yield* handler;
      }),
    );
    const serve = route(router, 400);
    yield* serve(ApiEndpoints.create, ({ body }) =>
      accept(
        body.requestId,
        Effect.gen(function* () {
          const data = yield* registry.get;
          if (!data.folders.includes(body.cwd) && !data.worktrees.some((w) => w.path === body.cwd))
            return yield* fail(400, "cwd is not a registered folder.");
          const workspace = data.workspaces.find((w) => w.path === body.cwd)!;
          const created = yield* hosts
            .createAndSubmit(
              { cwd: body.cwd, options: { model: body.model }, apiOwned: true },
              body.prompt,
            )
            .pipe(Effect.catch((e) => fail(409, e.detail)));
          return { workspaceId: workspace.id, ...created };
        }),
      ),
    );
    yield* serve(ApiEndpoints.send, ({ session, body }) =>
      accept(
        body.requestId,
        hosts.submit(session.cwd, session.sessionId, body.prompt, body.mode ?? "prompt").pipe(
          Effect.map((seq) => ({ seq })),
          Effect.catch((e) => fail(409, e.detail)),
        ),
      ),
    );
    yield* serve(ApiEndpoints.abort, ({ session, body }) =>
      Effect.gen(function* () {
        const live = yield* hosts.get(session.cwd, session.sessionId);
        if (live) {
          if (body.stop) {
            // Browser Stop returns queued input and cancels; API stop additionally kills Pi.
            yield* live
              .act({ _tag: "stop" })
              .pipe(
                Effect.ensuring(hosts.release(session.cwd, session.sessionId).pipe(Effect.orDie)),
              );
          } else if (!(yield* live.state).isQuiescent) yield* live.act({ _tag: "abort" });
        }
        return { ok: true as const };
      }).pipe(Effect.forkIn(scope), Effect.flatMap(Fiber.join)),
    );
    yield* serve(ApiEndpoints.get, ({ workspace, session }) =>
      Effect.gen(function* () {
        const live = yield* hosts.get(session.cwd, session.sessionId);
        const snapshot = live
          ? yield* live.snapshot
          : (yield* hosts.peek(session.cwd, session.sessionId)).snapshot;
        const current = (yield* registry.sessionIn(workspace.id, session.sessionId)).session;
        const status = snapshotStatus(snapshot, !!live);
        return {
          ...(!live && current.lastStatus === "error"
            ? { status: "error" as const, detail: current.lastDetail ?? status.detail }
            : status),
          lastAssistantMessage:
            snapshot.messages.findLast((m) => m.role === "assistant" && m.text.trim())?.text ??
            null,
          hosted: !!live,
          seq: current.seq ?? 0,
          completedSeq: current.completedSeq ?? 0,
        };
      }),
    );
    yield* serve(ApiEndpoints.list, () =>
      Effect.gen(function* () {
        const data = yield* registry.get;
        const live = yield* hosts.list;
        return yield* Effect.forEach(data.sessions, (session) =>
          Effect.gen(function* () {
            const workspace = data.workspaces.find((w) => w.path === session.cwd)!;
            const hosted = live.some(
              (h) => h.cwd === session.cwd && h.sessionId === session.sessionId,
            );
            const host = hosted ? yield* hosts.get(session.cwd, session.sessionId) : undefined;
            // No history reads: live state and the persisted last-known status only.
            const snapshot = host ? yield* host.snapshot : undefined;
            return {
              workspaceId: workspace.id,
              sessionId: session.sessionId,
              cwd: session.cwd,
              status: snapshot
                ? snapshotStatus(snapshot, true).status
                : (session.lastStatus ?? "idle"),
              hosted: !!host,
            };
          }),
        );
      }),
    );
  }),
);
