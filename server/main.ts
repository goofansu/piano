/**
 * Piano: start or continue Pi sessions across projects and worktrees.
 * Every running session is one `pi --mode rpc` child (see PiSessions).
 */
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpStaticServer } from "effect/http";
import { BroadcastLive } from "./Broadcast.ts";
import { CatalogLive } from "./Catalog.ts";
import { agentDir } from "./PiEnv.ts";
import { PiSessionsLive } from "./PiSessions.ts";
import { ProviderLoginLive } from "./ProviderLogin.ts";
import { CONFIG_PATH, RegistryLive, registryDatabasePath } from "./Registry.ts";
import { AppRouter } from "./Router.ts";
import { SessionHostsLive } from "./SessionHosts.ts";
import { SessionPullRequestsLive } from "./SessionPullRequests.ts";
import { WorkspaceChangesLive } from "./WorkspaceChanges.ts";
import { WorkspaceRevisionsLive } from "./WorkspaceRevisions.ts";

const PORT = Number(process.env.PORT ?? 7070);
const HOST = process.env.HOST ?? "127.0.0.1";
const IDLE_MS = Number(process.env.PIANO_IDLE_MINUTES ?? 30) * 60_000;
const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));

// Closing the HTTP server waits for its connections, and browsers hold WebSockets open
// indefinitely. The platform starts that close the moment a signal arrives, before any
// finalizer runs, so the sockets are torn down on the signal itself; otherwise Ctrl-C
// waits for the whole grace timeout.
const server = createServer();
const upgraded = new Set<Duplex>();
server.on("upgrade", (_req, socket) => {
  upgraded.add(socket);
  socket.once("close", () => upgraded.delete(socket));
});
const drain = () => {
  for (const s of upgraded) s.destroy();
  server.closeAllConnections();
};
process.once("SIGINT", drain);
process.once("SIGTERM", drain);
const Infra = NodeHttpServer.layer(() => server, { port: PORT, host: HOST, gracefulShutdownTimeout: "3 seconds" });
const Drain = Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(drain)));

const Core = Layer.mergeAll(SessionHostsLive({ idleMs: IDLE_MS }), CatalogLive, BroadcastLive, ProviderLoginLive, WorkspaceRevisionsLive, WorkspaceChangesLive, SessionPullRequestsLive).pipe(
  Layer.provideMerge(RegistryLive),
  Layer.provideMerge(PiSessionsLive),
  Layer.provide(Infra),
);

const Routes = Layer.mergeAll(AppRouter, HttpStaticServer.layer({ root: WEB_DIST, index: "index.html", spa: true }), Drain);

const Server = HttpRouter.serve(Routes, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provide(Core),
  Layer.provide(Infra),
);

const main = Layer.launch(Server).pipe(
  Effect.tap(() => Effect.void),
);

console.log(`[piano] http://${HOST}:${PORT}`);
console.log(`[piano] database ${registryDatabasePath(CONFIG_PATH, process.env.PIANO_DB_PATH)}; legacy config ${CONFIG_PATH}; Pi agent dir ${agentDir()}; web ${WEB_DIST}`);
NodeRuntime.runMain(main);
