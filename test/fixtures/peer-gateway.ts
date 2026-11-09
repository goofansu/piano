import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { WebSocket, WebSocketServer } from "@effect/platform-node/NodeWS";
import { emptySnapshot } from "../../shared/sessionProjection.ts";
import { seedRegistry } from "./registry.ts";

export const identity = {
  cwd: "/remote/registered",
  sessionId: "same-session",
  workspaceId: "same-workspace",
};
export const registry = {
  _tag: "registry",
  folders: [],
  projects: [],
  workspaces: [{ id: identity.workspaceId, path: identity.cwd, folder: identity.cwd }],
  sessionReferences: [
    {
      ...identity,
      branch: null,
      archived: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ],
};

export async function gatewayFixture(t: TestContext, options: { vmToken?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "piano-peer-"));
  for (const name of ["home", "agent", "sessions"]) mkdirSync(join(root, name));
  const database = join(root, "piano.db");
  seedRegistry(database, {
    folders: [identity.cwd],
    workspaces: registry.workspaces,
    sessions: [
      {
        cwd: identity.cwd,
        sessionId: identity.sessionId,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
  });
  const state = {
    mode: "ready",
    requiredToken: options.vmToken,
    running: false,
    connections: 0,
    disconnected: 0,
    initial: registry as unknown,
    requests: [] as { url: string; headers: IncomingHttpHeaders }[],
    received: [] as string[],
    sent: [] as string[],
  };
  const events = new EventTarget();
  const changed = () => events.dispatchEvent(new Event("change"));
  const until = async (predicate: () => boolean) => {
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (predicate()) {
          cleanup();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Peer observation timed out"));
      }, 10_000);
      const cleanup = () => {
        clearTimeout(timer);
        events.removeEventListener("change", check);
      };
      events.addEventListener("change", check);
      check();
    });
  };
  const upstream = createServer((req, res) => {
    state.requests.push({ url: req.url!, headers: req.headers });
    changed();
    if (
      state.requiredToken &&
      req.headers["x-exedev-authorization"] !== `Bearer ${state.requiredToken}`
    ) {
      res.writeHead(401).end("Unauthenticated");
      return;
    }
    if (state.mode === "http-unauthorized" || state.mode === "http-forbidden") {
      res
        .writeHead(state.mode === "http-unauthorized" ? 401 : 403)
        .end(`Refused ${state.requiredToken}`);
      return;
    }
    if (state.mode === "http-redirect") {
      res.writeHead(302, { location: "/unexpected" }).end();
      return;
    }
    if (state.mode === "http-dead") {
      res.destroy();
      return;
    }
    if (state.mode === "http-hang") return;
    if (state.mode === "http-large") {
      res.end("x".repeat(1024 * 1024 + 1));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ commands: [{ name: "remote-only", source: "extension" }] }));
  });
  const wss = new WebSocketServer({ noServer: true });
  upstream.on("upgrade", (req, socket, head) => {
    state.requests.push({ url: req.url!, headers: req.headers });
    changed();
    if (
      state.requiredToken &&
      req.headers["x-exedev-authorization"] !== `Bearer ${state.requiredToken}`
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (state.mode === "ws-forbidden") {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (state.mode === "redirect") {
      socket.end("HTTP/1.1 302 Found\r\nLocation: /unexpected\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (state.mode === "dead") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    state.connections++;
    let deliveryId = 0;
    const send = (frame: object) => {
      const raw = JSON.stringify(
        { ...frame, deliveryId: ++deliveryId, futureField: "preserve me" },
        null,
        1,
      );
      state.sent.push(raw);
      ws.send(raw);
      changed();
    };
    ws.on("close", () => {
      state.disconnected++;
      changed();
    });
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      const text = String(raw);
      state.received.push(text);
      const message = JSON.parse(text);
      if (message._tag === "select")
        send({
          _tag: "selected",
          selectionId: message.selectionId,
          cwd: message.cwd,
          sessionId: message.sessionId,
          hosted: true,
          cursor: {
            cwd: message.cwd,
            sessionId: message.sessionId,
            generation: "remote-generation",
            sequence: 71,
          },
          snapshot: emptySnapshot(message.sessionId),
        });
      if (message._tag === "ping") send({ _tag: "pong", nonce: message.nonce });
      if (message._tag === "act" && message.action._tag === "prompt") {
        state.running = true;
        send({
          _tag: "action_result",
          cwd: identity.cwd,
          sessionId: identity.sessionId,
          result: { _tag: "queue_restored", messages: [] },
        });
      }
      if (message._tag === "act" && ["stop", "abort"].includes(message.action._tag))
        state.running = false;
      changed();
    });
    if (state.mode === "silent") return;
    if (state.mode === "malformed") {
      ws.send("not-json");
      return;
    }
    send({ _tag: "hosts", hosts: [] });
    send(state.initial as object);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const vmTokenFile = join(root, "vm-token");
  if (options.vmToken) writeFileSync(vmTokenFile, `${options.vmToken}\n`, { mode: 0o600 });
  const config = {
    ...(options.vmToken ? { vmTokenFile } : {}),
    id: "eng-1",
    name: "Engineering",
    endpoint,
    origin: "https://eng-1.exe.xyz:3000",
  };
  writeFileSync(join(root, "peer.json"), JSON.stringify(config));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const local = reservation.address();
  assert.ok(local && typeof local !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${local.port}`;
  const child = spawn(process.execPath, ["server/main.ts"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      PATH: process.env.PATH,
      HOME: join(root, "home"),
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(local.port),
      PIANO_ALLOWED_ORIGINS: base,
      PIANO_DB_PATH: database,
      PIANO_PEER_CONFIG: join(root, "peer.json"),
      PI_CODING_AGENT_DIR: join(root, "agent"),
      PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
      PIANO_PI_CLI: new URL("../fake-pi.mjs", import.meta.url).pathname,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const browsers = new Set<WebSocket>();
  t.after(async () => {
    for (const ws of browsers) ws.terminate();
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
    if (child.exitCode === null) await exited;
    clearTimeout(force);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 20_000;
  while (true) {
    try {
      if ((await fetch(`${base}/api/machines`)).ok) break;
    } catch {
      /* startup */
    }
    assert.ok(Date.now() < deadline && child.exitCode === null, log);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const open = async (headers: Record<string, string> = {}, acknowledge = true) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/peer/eng-1/ws`, {
      headers: { Origin: base, ...headers },
    });
    browsers.add(ws);
    const messages: string[] = [];
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      ws.once("close", (code, reason) => resolve({ code, reason: String(reason) })),
    );
    ws.on("message", (raw) => {
      messages.push(String(raw));
      if (acknowledge)
        ws.send(JSON.stringify({ _tag: "ack", deliveryId: JSON.parse(String(raw)).deliveryId }));
      changed();
    });
    await once(ws, "open");
    await until(() => messages.some((raw) => JSON.parse(raw)._tag === "registry"));
    return { ws, messages, closed, send: (message: object) => ws.send(JSON.stringify(message)) };
  };
  const handshake = (path = "/peer/eng-1/ws", headers: Record<string, string> = {}) =>
    new Promise<number>((resolve, reject) => {
      const req = request(`${base}${path}`, {
        agent: false,
        headers: {
          Origin: base,
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          ...headers,
        },
      });
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      req.setTimeout(12_000, () => req.destroy(new Error("handshake timeout")));
      req.end();
    });
  return { state, base, config, open, handshake, until, wss, database, logs: () => log };
}
