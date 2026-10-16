/** A distinct, opt-in local listener. Never point the exe.dev HTTPS proxy at it. */
import { chmodSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, isAbsolute } from "node:path";
import { NodeHttpServer } from "@effect/platform-node";

export function apiListener(socket: string | undefined, port: string | undefined) {
  if (socket !== undefined) {
    if (!isAbsolute(socket)) throw new Error("PIANO_API_SOCKET must be an absolute path.");
    mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
    // Permissions are fixed synchronously on listening, before any request handler is installed.
    // Do not unlink an existing path: it may belong to a live listener or not be a socket at all.
    return NodeHttpServer.layer(
      () => {
        const server = createServer();
        server.once("listening", () => chmodSync(socket, 0o600));
        return server;
      },
      { path: socket, gracefulShutdownTimeout: "3 seconds" },
    );
  }
  if (port !== undefined) {
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
      throw new Error("PIANO_API_PORT must be a port between 1 and 65535.");
    return NodeHttpServer.layer(createServer, {
      host: "127.0.0.1",
      port: Number(port),
      gracefulShutdownTimeout: "3 seconds",
    });
  }
  return undefined;
}
