import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Cause, Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { RadiusSetupState } from "../shared/radius.ts";
import { type DirListing, SessionDefaults, SessionPullRequestAction } from "../shared/wire.ts";
import { Catalog } from "./Catalog.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { getImagePreview } from "./ImagePreviews.ts";
import { expandHome } from "./PiEnv.ts";
import { PiSettings } from "./PiSettings.ts";
import { ProviderLogin } from "./ProviderLogin.ts";
import { RadiusSetup } from "./RadiusSetup.ts";
import { Registry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { SessionPullRequests } from "./SessionPullRequests.ts";
import { buildFolders } from "./Views.ts";
import { WorkspaceChanges } from "./WorkspaceChanges.ts";
import { WorkspaceRevisions } from "./WorkspaceRevisions.ts";
import { gitHeadSubject, gitTopLevel } from "./Worktrees.ts";
import { handleSocket } from "./WsClient.ts";

/** Subdirectories for the folder picker, with git HEAD subjects for checkouts (as Shelley does). Hidden folders are skipped. */
const listDirectory = (raw: string) =>
  Effect.gen(function* () {
    const path = resolve(expandHome(raw || "~"));
    if (!existsSync(path)) return yield* Effect.fail(new Error(`No such directory: ${path}`));
    if (!statSync(path).isDirectory()) return yield* Effect.fail(new Error(`${path} is a file, not a directory`));
    const names: string[] = [];
    for (const name of readdirSync(path)) {
      if (name.startsWith(".")) continue;
      try {
        if (statSync(join(path, name)).isDirectory()) names.push(name);
      } catch {
        /* unreadable entry */
      }
    }
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const entries = yield* Effect.forEach(
      names,
      (name) =>
        Effect.gen(function* () {
          const full = join(path, name);
          const gitSubject = existsSync(join(full, ".git")) ? yield* gitHeadSubject(full) : undefined;
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

/** Paths travel in JSON bodies, never in URLs, so access logs and proxies don't record them. */
const readBody = Effect.gen(function* () {
  const text = yield* (yield* HttpServerRequest.HttpServerRequest).text.pipe(Effect.orElseSucceed(() => ""));
  try {
    const body: unknown = JSON.parse(text);
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
});

const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(projectDisplay(body), null, 2), { status, contentType: "application/json" });

export const AppRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
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

    yield* router.add(
      "POST",
      "/api/ls",
      Effect.gen(function* () {
        const { path } = yield* readBody;
        const raw = typeof path === "string" ? path : "~";
        return yield* listDirectory(raw).pipe(
          Effect.map((listing) => json(listing)),
          // Answer with the failure's own message, never the Effect cause wrapper.
          Effect.catchCause((cause) => {
            const e = Cause.squash(cause);
            const message = e instanceof Error ? (e as NodeJS.ErrnoException).code === "EACCES" ? `Cannot read ${raw}: permission denied` : e.message : String(e);
            return Effect.succeed(json({ error: message }, 400));
          }),
        );
      }),
    );

    // mkdir -p for the folder picker's "New folder".
    yield* router.add(
      "POST",
      "/api/mkdir",
      Effect.gen(function* () {
        const body = yield* readBody;
        const target = typeof body.path === "string" ? body.path : "";
        const path = resolve(expandHome(target));
        if (!target || path === "/" ) return json({ error: "path is required" }, 400);
        try {
          mkdirSync(path, { recursive: true });
          return json({ path });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 400);
        }
      }),
    );

    for (const method of ["GET", "PUT"] as const) {
      yield* router.add(method, "/api/session/pull-request", Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const params = new URL(request.url, "http://localhost").searchParams;
        const workspaceId = params.get("workspaceId"), sessionId = params.get("sessionId");
        if (!workspaceId || !sessionId) return json({ error: "Workspace and session IDs are required." }, 400);
        const registry = yield* (yield* Registry).get;
        const workspace = registry.workspaces.find(w => w.id === workspaceId);
        if (!workspace || !registry.sessions.some(s => s.cwd === workspace.path && s.sessionId === sessionId)) {
          return json({ error: "Session is not registered in this workspace. Refresh the session list." }, 404);
        }
        const cwd = workspace.path;
        const prs = yield* SessionPullRequests;
        if (method === "GET") return json(yield* prs.get(cwd, sessionId));
        const body = yield* request.text;
        const action = yield* Effect.try(() => Schema.decodeUnknownSync(Schema.fromJsonString(SessionPullRequestAction))(body));
        return json(yield* prs.change(cwd, sessionId, action));
      }).pipe(Effect.catchCause(cause => {
        const error = Cause.squash(cause);
        const message = error instanceof Error && "detail" in error ? String(error.detail) : "Invalid pull request request.";
        return Effect.succeed(json({ error: message }, 400));
      })));
    }

    for (const endpoint of ["changes", "changes/file"] as const) {
      yield* router.add("POST", `/api/workspace/${endpoint}`, Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const id = new URL(request.url, "http://localhost").searchParams.get("workspaceId");
        const workspace = (yield* (yield* Registry).get).workspaces.find(w => w.id === id);
        if (!workspace) return json({ error: "Workspace is not registered. Refresh the folder list." }, 404);
        const body = endpoint === "changes/file" ? yield* readBody : undefined;
        if (body && typeof body.path !== "string") return json({ error: "File path is required in the request body." }, 400);
        return json(yield* (yield* WorkspaceChanges).preview(workspace, body?.path as string | undefined));
      }));
    }

    yield* router.add("POST", "/api/workspace/capture", Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = new URL(request.url, "http://localhost").searchParams.get("workspaceId");
      const workspace = (yield* (yield* Registry).get).workspaces.find(w => w.id === id);
      if (!workspace) return json({ error: "Workspace is not registered. Refresh the folder list." }, 404);
      return json(yield* (yield* WorkspaceRevisions).capture(workspace));
    }));

    yield* router.add("GET", "/api/image-previews/:id", Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = new URL(request.url, "http://localhost").pathname.split("/").pop() ?? "";
      const image = /^[a-f0-9]{64}$/.test(id) ? getImagePreview(id) : undefined;
      return image ? HttpServerResponse.uint8Array(image.bytes, { contentType: image.mimeType,
        headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } })
        : HttpServerResponse.empty({ status: 404 });
    }));

    // Discovery never opens a saved session or creates a second writer. A live
    // session is resolved by server-owned identity; otherwise use the cwd probe.
    yield* router.add("POST", "/api/commands", Effect.gen(function* () {
      const body = yield* readBody;
      const raw = typeof body.cwd === "string" ? body.cwd : "";
      if (!raw) return json({ error: "Directory is required." }, 400);
      const cwd = resolve(expandHome(raw));
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
      if (sessionId) {
        const session = yield* (yield* SessionHosts).get(cwd, sessionId);
        if (!session) return json({ error: "Session is no longer running. Reopen the suggestions." }, 409);
        const result = yield* session.act({ _tag: "commands" });
        if (result?._tag === "commands") return json({ commands: result.commands });
        return json({ error: "Command catalog unavailable." }, 502);
      }
      const catalog = yield* (yield* Catalog).get(cwd);
      return catalog.error ? json({ error: catalog.error }, 502) : json({ commands: catalog.commands ?? [] });
    }).pipe(Effect.catchCause(() => Effect.succeed(json({ error: "Could not load commands. Reopen the suggestions to retry." }, 502)))));

    yield* router.add("PUT", "/api/settings/defaults", Effect.gen(function* () {
      const body = yield* readBody;
      const parsed = Schema.decodeUnknownExit(SessionDefaults)(body);
      if (parsed._tag === "Failure") return json({ error: "Choose a valid default model and effort." }, 400);
      return json({ defaults: yield* (yield* PiSettings).saveDefaults(parsed.value) });
    }).pipe(Effect.catchTag("PiSettingsError", error => Effect.succeed(json({ error: error.detail }, 400)))));

    for (const method of ["GET", "POST"] as const) {
      yield* router.add(method, "/api/settings/radius", Effect.gen(function* () {
        const setup = yield* RadiusSetup;
        let state: RadiusSetupState;
        if (method === "GET") state = yield* setup.state;
        else {
          const body = yield* readBody;
          if (body.action === "configure-mcp") state = yield* setup.configureMcp;
          else if (body.action === "install-web-search") state = yield* setup.installWebSearch;
          else if (body.action === "remove-mcp" && typeof body.removalKey === "string") state = yield* setup.removeMcp(body.removalKey);
          else if (body.action === "uninstall-web-search" && typeof body.removalKey === "string") state = yield* setup.uninstallWebSearch(body.removalKey);
          else return json({ error: "Invalid Radius setup action." }, 400);
        }
        return HttpServerResponse.text(JSON.stringify({ state }), { contentType: "application/json", headers: { "cache-control": "no-store" } });
      }).pipe(Effect.catchTag("RadiusSetupError", error => Effect.succeed(json({ error: error.detail }, 409)))));
    }

    yield* router.add("GET", "/api/oauth-providers", Effect.gen(function* () {
      return json({ providers: yield* (yield* ProviderLogin).providers });
    }).pipe(Effect.catchCause(() => Effect.succeed(json({ error: "Could not load OAuth providers." }, 502)))));

    yield* router.add("POST", "/api/provider-logout", Effect.gen(function* () {
      const body = yield* readBody;
      if (typeof body.provider !== "string") return json({ error: "Invalid sign-out request." }, 400);
      yield* (yield* ProviderLogin).signOut(body.provider);
      return json({ ok: true });
    }).pipe(Effect.catchCause(() => Effect.succeed(json({ error: "Could not sign out. Finish any sign-in in progress and try again." }, 409)))));

    // Credential values and callback URLs travel only in POST bodies. This
    // global operation creates no session and owns no conversation history.
    for (const method of ["GET", "POST", "DELETE", "PUT"] as const) {
      yield* router.add(method, "/api/provider-login", Effect.gen(function* () {
        const login = yield* ProviderLogin;
        let result: unknown;
        if (method === "GET") result = { state: yield* login.state };
        else {
          const body = yield* readBody;
          if (method === "POST" && typeof body.provider === "string") result = { state: yield* login.start(body.provider) };
          else if (method === "DELETE" && typeof body.id === "string") result = { state: yield* login.cancel(body.id) };
          else if (method === "PUT" && typeof body.id === "string" && typeof body.promptId === "string" && typeof body.value === "string" && body.value.length <= 16_384) result = { state: yield* login.answer(body.id, body.promptId, body.value) };
          else return json({ error: "Invalid sign-in request." }, 400);
        }
        return HttpServerResponse.text(JSON.stringify(result), { contentType: "application/json", headers: { "cache-control": "no-store" } });
      }).pipe(Effect.catchCause(() => Effect.succeed(json({ error: "Sign-in request could not be completed. Resume the current sign-in or try again." }, 409)))));
    }

    yield* router.add("GET", "/api/folders", buildFolders.pipe(Effect.map((folders) => json({ folders }))));
  }),
);
