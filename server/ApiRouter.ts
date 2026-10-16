import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ApiEndpoints } from "../shared/api.ts";
import type { Snapshot } from "../shared/wire.ts";
import { deriveStatus } from "./ApiStatus.ts";
import { Registry } from "./Registry.ts";
import { route } from "./Router.ts";
import { SessionHosts } from "./SessionHosts.ts";

/** Pi retains the last acknowledgement after settling; it is no longer an active submission. */
export const snapshotStatus = ({ state, dialogs }: Snapshot, hosted: boolean) =>
  deriveStatus(
    state.isQuiescent && ["started", "queued"].includes(state.submission?.outcome ?? "")
      ? { ...state, submission: undefined }
      : state,
    dialogs,
    hosted,
  );

export const ApiRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const hosts = yield* SessionHosts;
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
