/**
 * Piano: start or continue pi threads across projects and worktrees.
 * Every running thread is one `pi --mode rpc` child (see PiThreads).
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpStaticServer } from "effect/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { BroadcastLive } from "./Broadcast.ts";
import { CatalogLive } from "./Catalog.ts";
import { agentDir } from "./PiEnv.ts";
import { PiThreadsLive } from "./PiThreads.ts";
import { CONFIG_PATH } from "./Projects.ts";
import { AppRouter } from "./Router.ts";
import { ThreadHostsLive } from "./ThreadHosts.ts";

const PORT = Number(process.env.PORT ?? 7070);
const HOST = process.env.HOST ?? "127.0.0.1";
const IDLE_MS = Number(process.env.PIANO_IDLE_MINUTES ?? 30) * 60_000;
const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));

const Infra = NodeHttpServer.layer(() => createServer(), { port: PORT, host: HOST });

const Core = Layer.mergeAll(ThreadHostsLive({ idleMs: IDLE_MS }), CatalogLive, BroadcastLive).pipe(
  Layer.provideMerge(PiThreadsLive),
  Layer.provide(Infra),
);

const Routes = Layer.mergeAll(AppRouter, HttpStaticServer.layer({ root: WEB_DIST, index: "index.html", spa: true }));

const Server = HttpRouter.serve(Routes, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provide(Core),
  Layer.provide(Infra),
);

const main = Layer.launch(Server).pipe(
  Effect.tap(() => Effect.void),
);

console.log(`[piano] http://${HOST}:${PORT}`);
console.log(`[piano] config ${CONFIG_PATH}; pi agent dir ${agentDir()}; web ${WEB_DIST}`);
NodeRuntime.runMain(main);
