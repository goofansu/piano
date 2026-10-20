/**
 * Piano: start or continue Pi sessions across folders and worktrees.
 * Every running session is one `pi --mode rpc` child (see PiSessions).
 */
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { inboundLimits } from "./InboundCapacity.ts";
import { AllowedOrigins, configuredOrigins } from "./OriginPolicy.ts";
import { PianoAdaptersLive, PianoServicesLive } from "./PianoServices.ts";
import { defaultPiCli, PiCli } from "./PiCli.ts";
import { agentDir } from "./PiEnv.ts";
import { RegistryDatabasePath } from "./Registry.ts";
import { AppRouter } from "./Router.ts";
import { sessionEndpoint, sessionEnvironment } from "./SessionEndpoint.ts";
import { staticAssets } from "./StaticAssets.ts";

const PORT = Number(process.env.PORT ?? 7070);
const HOST = process.env.HOST ?? "127.0.0.1";
const origins = configuredOrigins(PORT, process.env.PIANO_ALLOWED_ORIGINS);
const IDLE_MS = Number(process.env.PIANO_IDLE_MINUTES ?? 30) * 60_000;
const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));
// Every Pi child loads Piano's session extension and is told how to reach this instance.
const endpoint = sessionEndpoint({ host: HOST, port: PORT }, origins);
const Launch = Layer.succeed(PiCli, {
  ...defaultPiCli(),
  ...(endpoint ? { env: sessionEnvironment(endpoint) } : {}),
});

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
// ws bounds the complete inflated message while assembling fragments, before JSON parsing.
const Infra = NodeHttpServer.layer(() => server, {
  port: PORT,
  host: HOST,
  gracefulShutdownTimeout: "3 seconds",
  websocket: {
    maxPayload: inboundLimits.frameBytes,
    perMessageDeflate: {
      // Independent messages avoid retaining a cross-message compression dictionary.
      // ws applies the threshold only with no context takeover: leave token/control frames alone.
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      threshold: 1024,
      zlibDeflateOptions: { level: 3 },
    },
  },
});
const Drain = Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(drain)));

// provideMerge, not provide: the HTTP handlers that open sessions read PiCli from their own
// context, so the launch configuration has to leave this layer as well as enter it.
const Services = PianoServicesLive({ idleMs: IDLE_MS }).pipe(
  Layer.provideMerge(Launch),
  Layer.provide(PianoAdaptersLive),
  Layer.provide(Infra),
);

const Routes = Layer.mergeAll(AppRouter, staticAssets({ root: WEB_DIST }), Drain);

const Server = HttpRouter.serve(Routes, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provide(Services),
  Layer.provide(Layer.succeed(AllowedOrigins, origins)),
  Layer.provide(Infra),
);

const main = Layer.launch(Server).pipe(Effect.tap(() => Effect.void));

console.log(`[piano] http://${HOST}:${PORT}`);
console.log(
  `[piano] database ${RegistryDatabasePath.defaultValue()}; Pi agent dir ${agentDir()}; web ${WEB_DIST}`,
);
NodeRuntime.runMain(main);
