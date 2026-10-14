import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeWS } from "@effect/platform-node/NodeSocket";

test("INV-11: a message Pi did not produce is redacted at socket egress", {
  timeout: 30_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "piano-egress-"));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const canary = "egress-canary-0123456789";
  const child = spawn(process.execPath, ["server/main.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PIANO_DB_PATH: join(root, "registry.db"),
      PI_CODING_AGENT_DIR: join(root, "agent"),
      PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
      PIANO_ALLOWED_ORIGINS: base,
      PIANO_PI_CLI: new URL("fake-pi.mjs", import.meta.url).pathname,
      // A known secret: its value is redacted wherever it appears.
      PIANO_EGRESS_TOKEN: canary,
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
    const ws = new NodeWS.WebSocket(`${base.replace("http", "ws")}/ws`, { origin: base });
    const received: string[] = [];
    const failed = new Promise<string>((resolve) =>
      ws.on("message", (data) => {
        const text = String(data);
        received.push(text);
        if (JSON.parse(text)._tag === "error") resolve(text);
      }),
    );
    await once(ws, "open");
    // Starting a session in a missing directory fails in the registry, before Pi runs: the error
    // names the path it was given and is Piano's, not Pi's.
    const missing = join(root, canary);
    ws.send(
      JSON.stringify({ _tag: "create_session", selectionId: "s1", cwd: missing, options: {} }),
    );
    const error = JSON.parse(await failed);
    assert.equal(error.message, `Not a directory: ${join(root, "[REDACTED]")}`);
    assert.ok(!received.join("\n").includes(canary), "no message carries the secret");
    ws.close();
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 5000);
    if (child.exitCode === null) await exited;
    clearTimeout(force);
    rmSync(root, { recursive: true, force: true });
  }
});
