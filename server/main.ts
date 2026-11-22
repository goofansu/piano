import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { sessionEndpoint, sessionEnvironment } from "../features/dispatch/server/index.ts";
import { ensurePianoFolders, pianoFolder } from "../features/library/server/index.ts";
import { PiCli } from "../features/sessions/server/index.ts";
import { PianoAdaptersLive, PianoServicesLive } from "./app/PianoServices.ts";
import { defaultPiCli } from "./app/PiLaunch.ts";
import { AppRouter } from "./app/Router.ts";
import { staticAssets } from "./app/StaticAssets.ts";
import { inboundLimits } from "./shared/InboundCapacity.ts";
import {
  AllowedOrigins,
  configuredOrigins,
  SessionLinkOrigin,
  sessionLinkOrigin,
} from "./shared/OriginPolicy.ts";
import { agentDir } from "./shared/PiEnv.ts";
import { RegistryDatabasePath } from "./shared/registry/Registry.ts";

const PORT = Number(process.env.PORT ?? 7070);
const HOST = process.env.HOST ?? "127.0.0.1";
const listener = { host: HOST, port: PORT };
const origins = configuredOrigins(PORT, process.env.PIANO_ALLOWED_ORIGINS);
const IDLE_MS = Number(process.env.PIANO_IDLE_MINUTES ?? 30) * 60_000;
const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));
const endpoint = sessionEndpoint(listener, origins);
ensurePianoFolders();
const Launch = Layer.succeed(PiCli, {
  ...defaultPiCli(),
  promptTemplates: [pianoFolder("prompts")],
  skills: [pianoFolder("skills")],
  ...(endpoint ? { env: sessionEnvironment(endpoint) } : {}),
});

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
const Infra = NodeHttpServer.layer(() => server, {
  port: PORT,
  host: HOST,
  gracefulShutdownTimeout: "3 seconds",
  websocket: {
    maxPayload: inboundLimits.frameBytes,
    perMessageDeflate: {
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      threshold: 1024,
      zlibDeflateOptions: { level: 3 },
    },
  },
});
const Drain = Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(drain)));

const Services = PianoServicesLive({ idleMs: IDLE_MS }).pipe(
  Layer.provideMerge(Launch),
  Layer.provide(PianoAdaptersLive),
  Layer.provide(Infra),
);

const Routes = Layer.mergeAll(AppRouter, staticAssets({ root: WEB_DIST }), Drain);

const Server = HttpRouter.serve(Routes, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provide(Services),
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(AllowedOrigins, origins),
      Layer.succeed(SessionLinkOrigin, sessionLinkOrigin(origins, listener)),
    ),
  ),
  Layer.provide(Infra),
);

const main = Layer.launch(Server).pipe(Effect.tap(() => Effect.void));

console.log(`[piano] http://${HOST}:${PORT}`);
console.log(
  `[piano] database ${RegistryDatabasePath.defaultValue()}; Pi agent dir ${agentDir()}; web ${WEB_DIST}`,
);
NodeRuntime.runMain(main);
