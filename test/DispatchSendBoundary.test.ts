/**
 * The start's send boundary through the real transport: the extension's Node socket and the shared
 * auto-reconnecting connection, against a running `server/main.ts` with the fake Pi. A socket that
 * never opens sent nothing, so the start is `refused` / `not_sent`. A send that throws after the
 * socket took the creation frame may have started a child. Read-only reconciliation can find
 * that child, but missed input observations stay uncertain and creation is never resent (PIN-137).
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

test(
  "a socket that never opens reports a start that was not sent",
  {
    timeout: 30_000,
  },
  async () => {
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
  },
);

test(
  "a creation send that throws but reaches Pi reconciles its child without resending",
  {
    timeout: 60_000,
  },
  async () => {
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
    const controller = new AbortController();
    let pendingStart: ReturnType<typeof startSession> | undefined;
    let closeFaulted: (() => void) | undefined;
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

      // Enqueue creation, then throw and hide its replies. Keep the underlying connection alive
      // until Pi receives the input: closing after a fixed delay races startup/attachment, and a
      // disconnect before attachment legitimately sends no prompt (covered in ClientSessions).
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
              closeFaulted = socket.close;
              throw new Error("send failed after enqueueing the frame");
            },
            close: () => {
              if (!faulted) socket.close();
            },
          };
        },
      };
      pendingStart = startSession(
        { cwd: repo, prompt: "write marker child.txt" },
        faulty,
        controller.signal,
      );

      // The fake Pi writes synchronously on receiving this prompt, before acknowledging it.
      // This is the delivery barrier, not an assumption about how fast the child starts.
      const marker = join(repo, "child.txt");
      const until = Date.now() + 15_000;
      while (!existsSync(marker)) {
        assert.ok(Date.now() < until, `the child never wrote its marker\n${logs}`);
        await delay(50);
      }
      assert.ok(closeFaulted, "the creation send threw after enqueueing its frame");
      closeFaulted();
      const result = await pendingStart;
      assert.deepEqual(
        [result.creation, result.submission, result.handle?.submissionId],
        ["created", "uncertain", null],
        JSON.stringify(result),
      );
      assert.ok(result.handle?.sessionId, "reconciliation identifies the original child");
      assert.equal(readFileSync(marker, "utf8").trim(), result.handle.sessionId);
      assert.equal(result.handle.inputFingerprint, "", "missed observations remain unattributable");
      // Longer than the transport's reconnect delay: nothing sends creation again.
      await delay(3_000);
      assert.equal(creations, 1, "the creation was sent once");
      assert.equal(opened, 2, "one read-only reconnect finds the original start");
      assert.equal(children().length, 1, "exactly one child exists");
    } finally {
      controller.abort();
      closeFaulted?.();
      await pendingStart;
      const exited = once(piano, "exit");
      piano.kill("SIGTERM");
      const force = setTimeout(() => piano.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(force);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
