/**
 * The start's send boundary through the real transport: the extension's Node socket and the shared
 * auto-reconnecting connection, against a running `server/main.ts` with the fake Pi. A socket that
 * never opens sent nothing, so the start is `refused` / `not_sent`. A send that throws after the
 * socket took the creation frame may have started a child, so the start is `uncertain` and the
 * creation is never sent again (PIN-137).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { nodeSocketEnvironment } from "../extensions/piano-dispatch/NodeSocket.ts";
import { startSession } from "../extensions/piano-dispatch/SessionDispatch.ts";
import type { SocketEnvironment } from "../web/src/lib/ws.ts";

const freePort = async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return address.port;
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a socket that never opens reports a start that was not sent", {
  timeout: 30_000,
}, async () => {
  // Nothing listens on this port: the real socket is refused before it opens.
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const result = await startSession(
    { cwd: tmpdir(), prompt: "hi" },
    nodeSocketEnvironment({ url: `ws://127.0.0.1:${port}/ws`, origin: base }),
  );
  assert.deepEqual(
    [result.creation, result.submission, result.handle],
    ["refused", "not_sent", null],
    JSON.stringify(result),
  );
  assert.match(result.detail ?? "", /not sent/);
});

test("a send that throws after the socket took the creation frame stays uncertain and is never resent", {
  timeout: 60_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-send-boundary-")));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    PIANO_DB_PATH: join(root, "registry.db"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
    PIANO_ALLOWED_ORIGINS: base,
    PIANO_PI_CLI: fileURLToPath(new URL("fake-pi.mjs", import.meta.url)),
  };
  let logs = "";
  const piano = spawn(process.execPath, ["server/main.ts"], {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  piano.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  piano.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  /** Pi processes Piano started: one per session it created. */
  const children = () => {
    try {
      return execFileSync("pgrep", ["-P", String(piano.pid), "-f", "fake-pi.mjs"], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/folders`)).ok) break;
      } catch {
        /* startup */
      }
      assert.ok(Date.now() < deadline && piano.exitCode === null, logs);
      await delay(50);
    }

    // The real Node socket, except that the creation frame's send enqueues it and then throws,
    // and the socket closes only after a delay, so its acknowledgement is lost to this client.
    const real = nodeSocketEnvironment({ url: wsUrl, origin: base });
    let opened = 0;
    let creations = 0;
    const faulty: SocketEnvironment = {
      ...real,
      open: (url, events) => {
        opened++;
        let faulted = false;
        const socket = real.open(url, {
          ...events,
          message: (data) => {
            if (!faulted) events.message(data);
          },
        });
        return {
          isOpen: socket.isOpen,
          send: (data) => {
            if (faulted) throw new Error("socket is failing");
            socket.send(data);
            if (!data.includes('"create_session"')) return;
            creations++;
            faulted = true;
            setTimeout(() => socket.close(), 500);
            throw new Error("send failed after enqueueing the frame");
          },
          close: () => {
            if (!faulted) socket.close();
          },
        };
      },
    };
    const result = await startSession({ cwd: repo, prompt: "write marker child.txt" }, faulty);
    assert.deepEqual(
      [result.creation, result.submission, result.handle],
      ["uncertain", "uncertain", null],
      JSON.stringify(result),
    );

    // The frame did reach Piano: its child ran.
    const marker = join(repo, "child.txt");
    const until = Date.now() + 15_000;
    while (!existsSync(marker)) {
      assert.ok(Date.now() < until, `the child never wrote its marker\n${logs}`);
      await delay(50);
    }
    assert.ok(readFileSync(marker, "utf8").trim());
    // Longer than the transport's reconnect delay: nothing reconnects to send it again.
    await delay(3_000);
    assert.equal(creations, 1, "the creation was sent once");
    assert.equal(opened, 1, "the start stopped observing instead of reconnecting");
    assert.equal(children().length, 1, "exactly one child exists");
  } finally {
    const exited = once(piano, "exit");
    piano.kill("SIGTERM");
    const force = setTimeout(() => piano.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(force);
    rmSync(root, { recursive: true, force: true });
  }
});
