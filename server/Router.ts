import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Cause, Effect } from "effect";
import { gitHeadSubject, gitTopLevel } from "./Worktrees.ts";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { DirListing } from "../shared/wire.ts";
import { Catalog } from "./Catalog.ts";
import { Registry } from "./Registry.ts";
import { WorkspaceRevisions } from "./WorkspaceRevisions.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { expandHome } from "./PiEnv.ts";
import { buildProjects } from "./Views.ts";
import { handleSocket } from "./WsClient.ts";
import { lookupPullRequests } from "./PullRequests.ts";

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
      "GET",
      "/api/ls",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const params = HttpServerRequest.searchParamsFromURL(new URL(request.url, "http://localhost"));
        const raw = typeof params.path === "string" ? params.path : "~";
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
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
        let target = "";
        try {
          target = String((JSON.parse(body) as { path?: string }).path ?? "");
        } catch {
          /* fall through */
        }
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

    // Pull requests for a session: the GitHub PR URLs seen in its transcript.
    yield* router.add(
      "GET",
      "/api/prs",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const params = HttpServerRequest.searchParamsFromURL(new URL(request.url, "http://localhost"));
        const urls = typeof params.urls === "string" && params.urls ? params.urls.split(" ").filter((u) => /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/.test(u)) : [];
        return json({ prs: yield* lookupPullRequests(urls.slice(0, 10)) });
      }),
    );

    yield* router.add("POST", "/api/workspace/capture", Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = new URL(request.url, "http://localhost").searchParams.get("workspaceId");
      const workspace = (yield* (yield* Registry).get).workspaces.find(w => w.id === id);
      if (!workspace) return json({ error: "Workspace is not registered. Refresh the project list." }, 404);
      return json(yield* (yield* WorkspaceRevisions).capture(workspace));
    }));

    yield* router.add("GET", "/api/projects", buildProjects.pipe(Effect.map((projects) => json({ projects }))));
    yield* router.add(
      "GET",
      "/api/models",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const cwd = new URL(request.url, "http://localhost").searchParams.get("cwd") ?? homedir();
        return json(yield* (yield* Catalog).get(resolve(expandHome(cwd))));
      }),
    );
  }),
);
