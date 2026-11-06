/**
 * Where a dispatched child runs, through the registered `piano_start_session` tool against a
 * running `server/main.ts` and the fake Pi. Piano's server runs in one checkout and the parent
 * session in another: a relative `cwd` must be read from the parent's checkout, never the server's,
 * or a child asked to edit its own checkout edits Piano's instead.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pianoDispatch from "../extensions/piano-dispatch/index.ts";
import type { SessionStatus, StartArguments, StartToolResult } from "../shared/dispatch.ts";
import type { ClientMessage } from "../shared/wire.ts";

const freePort = async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return address.port;
};

test(
  "dispatch inherits current project membership independently of its checkout, with an opt-out",
  {
    timeout: 60_000,
  },
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-dispatch-cwd-")));
    const checkout = (name: string) => {
      const dir = join(root, name);
      mkdirSync(dir);
      execFileSync("git", ["-C", dir, "init", "--quiet", "-b", "main"]);
      return dir;
    };
    // A: where Piano's server runs. B: the parent session's checkout. C: another checkout.
    const server = checkout("server");
    const parent = checkout("parent");
    const other = checkout("other");
    const nested = join(parent, "nested");
    mkdirSync(nested);

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
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
    const piano = spawn(
      process.execPath,
      [fileURLToPath(new URL("../server/main.ts", import.meta.url))],
      {
        cwd: server,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    piano.stdout.on("data", (chunk) => (logs += chunk));
    piano.stderr.on("data", (chunk) => (logs += chunk));
    try {
      const deadline = Date.now() + 30_000;
      for (;;) {
        try {
          if ((await fetch(`${base}/api/folders`)).ok) break;
        } catch {
          /* startup */
        }
        assert.ok(Date.now() < deadline && piano.exitCode === null, logs);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const tools = new Map<
        string,
        { execute: (...args: unknown[]) => Promise<{ details: unknown }> }
      >();
      const launch = { ...process.env };
      Object.assign(process.env, {
        PIANO_SESSION_WS_URL: `ws://127.0.0.1:${port}/ws`,
        PIANO_SESSION_ORIGIN: base,
      });
      try {
        pianoDispatch({
          registerFlag: () => {},
          getFlag: () => undefined,
          on: () => {},
          registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never),
        } as unknown as ExtensionAPI);
      } finally {
        process.env = launch;
      }
      let parentId: string | undefined;
      const context = { cwd: parent, sessionManager: { getSessionId: () => parentId } };
      const start = async (marker: string, cwd?: string, options: Partial<StartArguments> = {}) =>
        (
          await tools.get("piano_start_session")!.execute(
            marker,
            {
              prompt: `write marker ${marker}`,
              ...(cwd === undefined ? {} : { cwd }),
              ...options,
            },
            undefined,
            undefined,
            context,
          )
        ).details as StartToolResult;
      const status = async (started: StartToolResult) => {
        assert.equal(started.creation, "created", JSON.stringify(started));
        return (
          await tools
            .get("piano_session_status")!
            .execute(
              "status",
              { sessionId: started.handle!.sessionId },
              undefined,
              undefined,
              context,
            )
        ).details as SessionStatus;
      };
      // Standalone starts have no parent; membership is never guessed from a directory.
      const parentStart = await start("parent");
      assert.equal((await status(parentStart)).projectId, null);
      parentId = parentStart.handle!.sessionId;
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Origin: base },
      } as unknown as string[]);
      socket.addEventListener("message", (event) => {
        const { deliveryId } = JSON.parse(String(event.data));
        socket.send(JSON.stringify({ _tag: "ack", deliveryId }));
      });
      await once(socket, "open");
      const mutate = async (message: ClientMessage) => {
        const reply = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            socket.removeEventListener("message", onMessage);
            reject(new Error(`No mutation acknowledgement: ${JSON.stringify(message)}\n${logs}`));
          }, 5000);
          const onMessage = (event: MessageEvent) => {
            const received = JSON.parse(String(event.data));
            if (received._tag !== "toast" && received._tag !== "error") return;
            clearTimeout(timeout);
            socket.removeEventListener("message", onMessage);
            if (received._tag === "error") reject(new Error(received.message));
            else resolve();
          };
          socket.addEventListener("message", onMessage);
        });
        socket.send(JSON.stringify(message));
        await reply;
      };
      const assign = (projectId: string | null) =>
        mutate({
          _tag: "assign_project",
          cwd: parent,
          sessionId: parentId!,
          projectId,
        });
      try {
        await mutate({
          _tag: "save_project",
          project: { id: "first", name: "First" },
          assign: { cwd: parent, sessionId: parentId },
        });
        const everywhere = [server, parent, nested, other];
        const writtenIn = (marker: string) =>
          everywhere.filter((dir) => existsSync(join(dir, marker)));

        for (const [marker, cwd, expected] of [
          ["omitted", undefined, parent],
          ["dot", ".", parent],
          ["relative", "nested", nested],
          ["parent-relative", "nested/..", parent],
          ["absolute", other, other],
        ] as const) {
          const started = await start(marker, cwd);
          assert.equal(
            started.creation,
            "created",
            `${marker}: ${JSON.stringify(started)}\n${logs}`,
          );
          assert.equal(started.cwd, expected, marker);
          assert.equal((await status(started)).projectId, "first", marker);
          assert.deepEqual(writtenIn(marker), [expected], `${marker} ran only in ${expected}`);
          assert.equal(
            readFileSync(join(expected, marker), "utf8").trim(),
            started.handle?.sessionId,
            `${marker} was written by the child the start names`,
          );
        }

        const inherited = await start("inherited");
        const optedOut = await start("opted-out", other, { inheritProject: false });
        assert.equal((await status(optedOut)).projectId, null);
        await mutate({ _tag: "save_project", project: { id: "second", name: "Second" } });
        await assign("second");
        assert.equal((await status(await start("moved", other))).projectId, "second");
        assert.equal(
          (await status(inherited)).projectId,
          "first",
          "existing children never move with the parent",
        );
        await assign(null);
        assert.equal((await status(await start("ungrouped"))).projectId, null);
        parentId = "missing-parent";
        const unknown = await start("unknown-parent", other, {
          worktree: { branch: "must-not-exist" },
        });
        assert.deepEqual(
          [unknown.creation, unknown.submission, unknown.handle],
          ["refused", "not_sent", null],
        );
        assert.match(unknown.detail ?? "", /parent session is unlisted or ambiguous/);
        assert.equal(
          execFileSync("git", ["-C", other, "branch", "--list", "must-not-exist"], {
            encoding: "utf8",
          }),
          "",
        );
        assert.deepEqual(writtenIn("unknown-parent"), []);
        assert.equal(
          (await status(await start("unknown-opt-out", other, { inheritProject: false })))
            .projectId,
          null,
        );
        parentId = parentStart.handle!.sessionId;

        // A missing relative destination refuses before any child runs, naming where it looked.
        const missing = await start("missing", "absent");
        assert.deepEqual(
          [missing.creation, missing.submission, missing.handle, missing.detail],
          ["refused", "not_sent", null, `Not a directory: ${join(parent, "absent")}`],
        );
        assert.deepEqual(writtenIn("missing"), []);
      } finally {
        socket.close();
      }
    } finally {
      if (piano.exitCode === null) {
        const exited = once(piano, "exit");
        piano.kill("SIGTERM");
        const force = setTimeout(() => piano.kill("SIGKILL"), 5000);
        await exited;
        clearTimeout(force);
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
