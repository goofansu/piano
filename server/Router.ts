import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { DirListing } from "../shared/wire.ts";
import { Catalog } from "./Catalog.ts";
import { expandHome } from "./PiEnv.ts";
import { buildProjects } from "./Views.ts";
import { handleSocket } from "./WsSession.ts";

/** Subdirectories for the folder picker. Hidden folders are skipped. */
function listDirectory(raw: string): DirListing {
  const path = resolve(expandHome(raw || "~"));
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Not a directory: ${path}`);
  const entries: DirListing["entries"][number][] = [];
  for (const name of readdirSync(path)) {
    if (name.startsWith(".")) continue;
    const full = join(path, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    entries.push({ name, path: full, git: existsSync(join(full, ".git")) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, home: homedir(), entries };
}

const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body, null, 2), { status, contentType: "application/json" });

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
        try {
          return json(listDirectory(raw));
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 400);
        }
      }),
    );

    yield* router.add("GET", "/api/projects", buildProjects.pipe(Effect.map((projects) => json({ projects }))));
    yield* router.add(
      "GET",
      "/api/models",
      Catalog.pipe(
        Effect.flatMap((c) => c.get),
        Effect.map((catalog) => json(catalog)),
      ),
    );
  }),
);
