/**
 * What a Pi child is launched with: Piano's own extension, resolved from this installation, and
 * the endpoint it needs to reach the Piano that spawned it. The second test runs the real
 * `server/main.ts`, because the launch is only correct if the configuration survives the service
 * graph and the handed origin actually passes the origin check (INV-11).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configuredOrigins, sessionLinkOrigin } from "../server/OriginPolicy.ts";
import { askUserExtension, defaultPiCli, sessionExtension } from "../server/PiCli.ts";
import { sessionEndpoint, sessionEnvironment } from "../server/SessionEndpoint.ts";

test("Piano's extension is resolved from the installation, never from the session's cwd", () => {
  assert.ok(isAbsolute(sessionExtension));
  assert.equal(
    sessionExtension,
    fileURLToPath(new URL("../extensions/piano-sessions/index.ts", import.meta.url)),
  );
  assert.equal(
    askUserExtension,
    fileURLToPath(new URL("../extensions/piano-ask-user/index.ts", import.meta.url)),
  );
  assert.deepEqual(defaultPiCli().extensions, [sessionExtension, askUserExtension]);
  // A session runs in the user's repository, so the launch must not follow the process cwd there.
  const installation = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.deepEqual(defaultPiCli().extensions, [sessionExtension, askUserExtension]);
  } finally {
    process.chdir(installation);
  }
});

test("the session endpoint addresses the listener and borrows an already-allowed origin", () => {
  const listener = { host: "127.0.0.1", port: 7070 };
  const loopback = new Set(["http://127.0.0.1:7070", "http://localhost:7070", "http://[::1]:7070"]);
  assert.deepEqual(sessionEndpoint(listener, loopback), {
    wsUrl: "ws://127.0.0.1:7070/ws",
    origin: "http://127.0.0.1:7070",
  });

  // Behind a proxy the child still reaches the loopback listener, and presents an allowed origin
  // rather than inventing one for itself.
  assert.deepEqual(sessionEndpoint(listener, new Set(["https://piano.example"])), {
    wsUrl: "ws://127.0.0.1:7070/ws",
    origin: "https://piano.example",
  });

  // Development: the backend is on 7070 and the only allowed origin is Vite's.
  assert.deepEqual(sessionEndpoint(listener, new Set(["http://localhost:5173"])), {
    wsUrl: "ws://127.0.0.1:7070/ws",
    origin: "http://localhost:5173",
  });

  // Wildcard bind addresses are not connectable.
  for (const [host, authority] of [
    ["0.0.0.0", "127.0.0.1:7070"],
    ["", "127.0.0.1:7070"],
    ["::", "[::1]:7070"],
    ["::1", "[::1]:7070"],
  ] as const) {
    assert.equal(
      sessionEndpoint({ host, port: 7070 }, loopback)?.wsUrl,
      `ws://${authority}/ws`,
      host,
    );
  }
  assert.equal(sessionEndpoint({ host: "::", port: 7070 }, loopback)?.origin, "http://[::1]:7070");

  // No configured origin means no endpoint: a child cannot be handed one that would widen policy.
  assert.equal(sessionEndpoint(listener, new Set()), undefined);
  assert.equal(sessionEndpoint({ host: "192.0.2.1", port: 7070 }, loopback), undefined);

  assert.deepEqual(
    sessionEnvironment({ wsUrl: "ws://127.0.0.1:7070/ws", origin: "https://piano.example" }),
    {
      PIANO_SESSION_WS_URL: "ws://127.0.0.1:7070/ws",
      PIANO_SESSION_ORIGIN: "https://piano.example",
    },
  );
});

// Webhooks and the session endpoint both link by this rule; without the listener, a webhook named
// 127.0.0.1 for a Piano listening only on [::1] (docs/configuration.md#session-link-origin).
test("a session link opens from the listener's own origin unless an HTTPS one is configured", () => {
  const loopback = configuredOrigins(7070);
  for (const [host, origin] of [
    ["127.0.0.1", "http://127.0.0.1:7070"],
    ["0.0.0.0", "http://127.0.0.1:7070"],
    ["localhost", "http://localhost:7070"],
    ["::1", "http://[::1]:7070"],
    ["::", "http://[::1]:7070"],
  ] as const)
    assert.equal(sessionLinkOrigin(loopback, { host, port: 7070 }), origin, host);
  // A listener no origin names falls back to the first; an HTTPS origin wins over all.
  const listener = { host: "192.0.2.1", port: 7070 };
  assert.equal(sessionLinkOrigin(loopback, listener), "http://127.0.0.1:7070");
  const proxied = configuredOrigins(7070, "http://[::1]:7070,https://piano.example");
  assert.equal(sessionLinkOrigin(proxied, { host: "::1", port: 7070 }), "https://piano.example");
});

test("a running Piano launches Pi with its extension and a usable endpoint", {
  timeout: 60_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "piano-launch-"));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const proxy = "https://piano.example";

  // Records how Piano launched Pi, then behaves as the fake Pi the probe talks to.
  const captured = join(root, "launch.jsonl");
  const shim = join(root, "pi-cli.mjs");
  writeFileSync(
    shim,
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(captured)}, JSON.stringify({
  argv: process.argv.slice(2),
  wsUrl: process.env.PIANO_SESSION_WS_URL ?? null,
  origin: process.env.PIANO_SESSION_ORIGIN ?? null,
}) + "\\n");
await import(${JSON.stringify(pathToFileURL(new URL("fake-pi.mjs", import.meta.url).pathname).href)});
`,
  );

  const child = spawn(process.execPath, ["server/main.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PIANO_DB_PATH: join(root, "registry.db"),
      PI_CODING_AGENT_DIR: join(root, "agent"),
      PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
      // The listener's origin is listed first to show the HTTPS origin a link opens from wins.
      PIANO_ALLOWED_ORIGINS: `${base},${proxy}`,
      PIANO_PI_CLI: shim,
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
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/folders`)).ok) break;
      } catch {
        /* startup */
      }
      assert.ok(Date.now() < deadline && child.exitCode === null, logs);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Any request that needs Pi's facts spawns a child; the commands probe is the cheapest.
    const commands = await fetch(`${base}/api/commands`, {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ cwd: root }),
    });
    assert.equal(commands.status, 200, logs);
    assert.ok(existsSync(captured), `Pi was never spawned: ${logs}`);

    const launch = JSON.parse(readFileSync(captured, "utf8").split("\n")[0]) as {
      argv: string[];
      wsUrl: string | null;
      origin: string | null;
    };
    assert.deepEqual(
      launch.argv.slice(0, 6),
      ["--mode", "rpc", "--extension", sessionExtension, "--extension", askUserExtension],
      "the extension loads before the session arguments",
    );
    assert.equal(launch.wsUrl, `ws://127.0.0.1:${port}/ws`);
    assert.equal(launch.origin, proxy, "a `/s/<id>` link must open from a remote browser");

    // The handed values must actually work: Node's built-in WebSocket can set Origin through
    // undici's `headers` option, which the installed types do not describe.
    const socket = new WebSocket(launch.wsUrl, {
      headers: { Origin: launch.origin },
    } as unknown as string[]);
    const opened = await Promise.race([
      once(socket, "open").then(() => "open" as const),
      once(socket, "error").then(() => "error" as const),
    ]);
    socket.close();
    assert.equal(opened, "open", "the endpoint Piano hands a child passes its own origin check");

    // And the policy is still closed: the endpoint borrows an origin, it does not add one.
    const rejected = new WebSocket(launch.wsUrl, {
      headers: { Origin: "https://evil.example" },
    } as unknown as string[]);
    const outcome = await Promise.race([
      once(rejected, "open").then(() => "open" as const),
      once(rejected, "error").then(() => "error" as const),
    ]);
    rejected.close();
    assert.equal(outcome, "error");
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 5000);
    if (child.exitCode === null) await exited;
    clearTimeout(force);
    rmSync(root, { recursive: true, force: true });
  }
});
