import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { test } from "node:test";
import {
  dispatchConfiguration,
  nodeSocketEnvironment,
} from "../extensions/piano-dispatch/NodeSocket.ts";
import { sessionEndpoint, sessionEnvironment } from "../server/SessionEndpoint.ts";

// INV-11: a non-browser observer must still send the explicit allowed Origin.
test("dispatch uses Node's native WebSocket with the configured Origin", async () => {
  const server = createServer();
  const sockets = new Set<Socket>();
  let origin: string | undefined;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket) => {
    origin = request.headers.origin;
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const env = nodeSocketEnvironment({
    url: `ws://127.0.0.1:${port}/ws`,
    origin: "https://piano.example.invalid",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket did not open")), 3000);
      env.open(env.url(), {
        open: () => {
          clearTimeout(timeout);
          resolve();
        },
        error: () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket rejected"));
        },
        message: () => {},
        close: () => {},
      });
    });
    assert.equal(origin, "https://piano.example.invalid");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("dispatch is unavailable without trusted local launch configuration", () => {
  assert.equal(dispatchConfiguration({}), undefined);
  const env = {
    PIANO_SESSION_WS_URL: "ws://127.0.0.1:7070/ws",
    PIANO_SESSION_ORIGIN: "http://localhost:7070",
  };
  assert.deepEqual(dispatchConfiguration(env), {
    url: env.PIANO_SESSION_WS_URL,
    origin: env.PIANO_SESSION_ORIGIN,
  });
  for (const url of [
    "wss://example.com/ws",
    "ws://user:secret@localhost/ws",
    "ws://localhost/ws?token=secret",
    "http://localhost/ws",
  ])
    assert.equal(dispatchConfiguration({ ...env, PIANO_SESSION_WS_URL: url }), undefined);
  assert.equal(
    dispatchConfiguration({ ...env, PIANO_SESSION_ORIGIN: "http://localhost:7070/" }),
    undefined,
  );
});

// The two halves are tested apart above; if Piano's launch drifted from what the extension
// accepts, the dispatch tools would silently stop registering.
test("every endpoint Piano launches a child with is one the extension accepts", () => {
  for (const [host, origins] of [
    ["127.0.0.1", ["http://127.0.0.1:7070"]],
    ["0.0.0.0", ["http://localhost:5173"]],
    ["::", ["http://[::1]:7070"]],
    ["localhost", ["https://piano.example"]],
  ] as const) {
    const endpoint = sessionEndpoint({ host, port: 7070 }, new Set(origins));
    assert.ok(endpoint, host);
    assert.deepEqual(dispatchConfiguration(sessionEnvironment(endpoint)), {
      url: endpoint.wsUrl,
      origin: endpoint.origin,
    });
  }
});
