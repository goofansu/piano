import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configuredOrigins, sessionLinkOrigin } from "../server/OriginPolicy.ts";
import { defaultPiCli } from "../server/PiCli.ts";
import { sessionEndpoint, sessionEnvironment } from "../server/SessionEndpoint.ts";
import { freePort } from "./fixtures/ports.ts";

test("Piano's extensions are resolved from the installation, never from the session's cwd", () => {
  const installed = (name: string) =>
    fileURLToPath(new URL(`../extensions/${name}/index.ts`, import.meta.url));
  const expected = [
    installed("piano-session"),
    installed("piano-project"),
    installed("piano-dispatch"),
    installed("piano-preview"),
    installed("piano-ask-user"),
    installed("piano-library"),
    installed("radius-artifacts"),
    fileURLToPath(
      new URL("../node_modules/@earendil-works/pi-claude-code/src/index.ts", import.meta.url),
    ),
  ];
  assert.deepEqual(defaultPiCli().extensions, expected);
  const installation = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.deepEqual(defaultPiCli().extensions, expected);
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

  assert.deepEqual(sessionEndpoint(listener, new Set(["https://piano.example"])), {
    wsUrl: "ws://127.0.0.1:7070/ws",
    origin: "https://piano.example",
  });

  assert.deepEqual(sessionEndpoint(listener, new Set(["http://localhost:5173"])), {
    wsUrl: "ws://127.0.0.1:7070/ws",
    origin: "http://localhost:5173",
  });

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
  const listener = { host: "192.0.2.1", port: 7070 };
  assert.equal(sessionLinkOrigin(loopback, listener), "http://127.0.0.1:7070");
  const proxied = configuredOrigins(7070, "http://[::1]:7070,https://piano.example");
  assert.equal(sessionLinkOrigin(proxied, { host: "::1", port: 7070 }), "https://piano.example");
});

test(
  "a running Piano launches Pi with its extensions and a usable endpoint",
  {
    timeout: 60_000,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "piano-launch-"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const proxy = "https://piano.example";

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
        } catch {}
        assert.ok(Date.now() < deadline && child.exitCode === null, logs);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

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
      const leading = [
        "--mode",
        "rpc",
        ...defaultPiCli().extensions!.flatMap((path) => ["--extension", path]),
      ];
      assert.deepEqual(
        launch.argv.slice(0, leading.length),
        leading,
        "the extensions load before the session arguments",
      );
      assert.equal(launch.wsUrl, `ws://127.0.0.1:${port}/ws`);
      assert.equal(launch.origin, proxy, "a `/s/<id>` link must open from a remote browser");

      const socket = new WebSocket(launch.wsUrl, {
        headers: { Origin: launch.origin },
      } as unknown as string[]);
      const opened = await Promise.race([
        once(socket, "open").then(() => "open" as const),
        once(socket, "error").then(() => "error" as const),
      ]);
      socket.close();
      assert.equal(opened, "open", "the endpoint Piano hands a child passes its own origin check");

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
  },
);
