import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeWS } from "@effect/platform-node/NodeSocket";
import { inboundLimits } from "../server/InboundCapacity.ts";
import { configuredOrigins } from "../server/OriginPolicy.ts";

test("origin configuration fails closed and does not implicitly extend explicit origins", () => {
  assert.deepEqual(
    [...configuredOrigins(7070)],
    ["http://127.0.0.1:7070", "http://localhost:7070", "http://[::1]:7070"],
  );
  assert.deepEqual(
    [...configuredOrigins(7070, "https://piano.example")],
    ["https://piano.example"],
  );
  for (const value of [
    "",
    "null",
    "*",
    "https://*.example",
    "https://piano.example/",
    "https://user@piano.example",
    "file:///tmp",
    "https://piano.example,",
    "https://piano.example/path",
  ]) {
    assert.throws(() => configuredOrigins(7070, value), /PIANO_ALLOWED_ORIGINS/);
  }
});

test("INV-11: real HTTP and WebSocket boundaries reject untrusted origins before work", {
  timeout: 30_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "piano-origin-"));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const proxy = "https://piano.example";
  const child = spawn(process.execPath, ["server/main.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PIANO_DB_PATH: join(root, "registry.db"),
      PI_CODING_AGENT_DIR: join(root, "agent"),
      PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
      PIANO_ALLOWED_ORIGINS: `${base},${proxy}`,
      PIANO_PI_CLI: new URL("fake-pi.mjs", import.meta.url).pathname,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  try {
    // Startup takes far longer than usual while other test files load the machine.
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/folders`)).ok) break;
      } catch {
        /* startup */
      }
      assert.ok(Date.now() < deadline && child.exitCode === null, logs);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const handshake = (origin?: string, extra: Record<string, string> = {}) =>
      new Promise<number>((resolve, reject) => {
        const req = request(`${base}/ws`, {
          headers: {
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            ...(origin === undefined ? {} : { Origin: origin }),
            ...extra,
          },
        });
        req.on("upgrade", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode!);
        });
        req.on("response", (res) => {
          res.resume();
          resolve(res.statusCode!);
        });
        req.on("error", reject);
        req.setTimeout(5000, () => req.destroy(new Error("handshake timeout")));
        req.end();
      });
    for (const origin of [
      undefined,
      "null",
      "https://evil.example",
      `${proxy}.evil.example`,
      `${proxy}/`,
      `${base}, ${proxy}`,
    ]) {
      const path = join(root, "rejected");
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await fetch(`${base}/api/mkdir`, {
          method,
          headers: {
            "content-type": "application/json",
            ...(origin === undefined ? {} : { origin }),
            "x-forwarded-host": "piano.example",
            "x-forwarded-proto": "https",
            Forwarded: "host=piano.example;proto=https",
          },
          body: JSON.stringify({ path }),
        });
        assert.equal(res.status, 403, `${method} ${origin}`);
      }
      assert.equal(existsSync(path), false, "denied request must not create a folder");
      assert.equal(
        await handshake(origin, {
          "x-forwarded-host": "piano.example",
          "x-forwarded-proto": "https",
        }),
        403,
        `ws ${origin}`,
      );
    }
    for (const origin of [base, proxy]) {
      const path = join(root, origin === base ? "local" : "proxy");
      const res = await fetch(`${base}/api/mkdir`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      assert.equal(res.status, 200);
      assert.ok(existsSync(path));
      assert.equal(await handshake(origin), 101);
    }
    assert.equal((await fetch(`${base}/api/folders`)).status, 200, "safe reads need no Origin");
    // DNS rebinding: the page's own hostname arrives as Host, with no Origin to refuse.
    const readWithHost = (host: string, extra: Record<string, string> = {}) =>
      new Promise<number>((resolve, reject) => {
        const req = request(`${base}/api/folders`, { headers: { host, ...extra } }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        });
        req.on("error", reject);
        req.end();
      });
    for (const host of ["rebound.example", `rebound.example:${port}`, `piano.example.evil.example`])
      assert.equal(await readWithHost(host), 403, `GET with Host ${host}`);
    assert.equal(
      await readWithHost("rebound.example", { "x-forwarded-host": "piano.example" }),
      403,
      "a forwarded host never stands in for Host",
    );
    for (const host of [
      "piano.example",
      "PIANO.example",
      "piano.example:443",
      `localhost:${port}`,
      `[::1]:${port}`,
    ])
      assert.equal(await readWithHost(host), 200, `GET with Host ${host}`);
    for (const compressed of [false, true]) {
      const connect = () =>
        new NodeWS.WebSocket(`${base.replace("http", "ws")}/ws`, {
          origin: base,
          perMessageDeflate: compressed,
        });
      const ws = connect();
      try {
        const opened = once(ws, "open");
        const [response] = await once(ws, "upgrade");
        await opened;
        assert.equal(ws.extensions, compressed ? "permessage-deflate" : "");
        if (compressed) {
          const extensions = response.headers["sec-websocket-extensions"];
          assert.match(extensions, /server_no_context_takeover/);
          assert.match(extensions, /client_no_context_takeover/);
        }
        // Both small control messages and bulk payloads survive negotiation unchanged.
        // The no-extension case also protects native Node WebSocket dispatch clients.
        for (const nonce of ["small", "large-".repeat(2048)]) {
          const pong = new Promise<string>((resolve) => {
            const receive = (data: NodeWS.RawData) => {
              const message = JSON.parse(data.toString());
              if (message._tag === "pong") {
                ws.off("message", receive);
                resolve(message.nonce);
              }
            };
            ws.on("message", receive);
          });
          ws.send(JSON.stringify({ _tag: "ping", nonce }));
          assert.equal(await pong, nonce);
        }
      } finally {
        ws.terminate();
      }
      // The actual parser bounds the complete *inflated* message, including fragments,
      // before JSON/schema decoding. Highly compressible input must not bypass the limit.
      for (const fragmented of [false, true]) {
        const oversized = connect();
        try {
          await once(oversized, "open");
          const closed = once(oversized, "close");
          if (fragmented) {
            const half = Buffer.alloc(inboundLimits.frameBytes / 2, 120);
            oversized.send(half, { fin: false });
            oversized.send(half, { fin: false });
            oversized.send("x", { fin: true });
          } else oversized.send(Buffer.alloc(inboundLimits.frameBytes + 1, 120));
          const [code] = await closed;
          assert.equal(
            code,
            1009,
            `oversized ${compressed ? "compressed" : "plain"} ${fragmented ? "fragmented" : "single"} input closes with 1009`,
          );
        } finally {
          oversized.terminate();
        }
      }
    }
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 5000);
    if (child.exitCode === null) await exited;
    clearTimeout(force);
    rmSync(root, { recursive: true, force: true });
  }
});
