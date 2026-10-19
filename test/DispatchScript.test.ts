import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
} from "../shared/wire.ts";

const script = fileURLToPath(new URL("../scripts/dispatch-session.ts", import.meta.url));
const origin = "http://localhost:7172";

function fixture(t: TestContext) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "piano-dispatch-")));
  const main = join(dir, "main checkout");
  const linked = join(dir, "linked checkout");
  const plain = join(dir, "not git");
  t.after(() => {
    try {
      if (existsSync(linked)) {
        execFileSync("git", ["-C", main, "worktree", "remove", "--force", linked]);
        execFileSync("git", ["-C", main, "branch", "-D", "linked"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  mkdirSync(main);
  mkdirSync(plain);
  const git = (...args: string[]) => execFileSync("git", ["-C", main, ...args], { stdio: "pipe" });
  git("init");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
  git("worktree", "add", "-b", "linked", linked);
  const alias = join(dir, "alias");
  symlinkSync(linked, alias);
  const prompt = join(dir, "prompt.txt");
  writeFileSync(prompt, "Reply with exactly: PORTABLE");
  return { dir, main, linked, plain, alias, prompt };
}

function run(args: string[], url: string, env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        timeout: 10_000,
        env: { ...process.env, PIANO_SESSION_WS_URL: url, PIANO_SESSION_ORIGIN: origin, ...env },
      },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

/** Minimal wire peer: exercise the actual CLI/native WebSocket, without a server or Pi history. */
async function peer(
  t: TestContext,
  registration: "ready" | "refused" | "closed" | "wrong-path" = "ready",
) {
  const requests: ClientMessage[] = [];
  const origins: (string | undefined)[] = [];
  const sockets = new Set<Socket>();
  const server = createServer();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.on("upgrade", (request, socket) => {
    origins.push(request.headers.origin);
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let deliveryId = 0;
    const send = (message: ServerMessage) => {
      const payload = Buffer.from(encodeServerMessage(message, ++deliveryId));
      const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
      header[0] = 0x81;
      header[1] = payload.length < 126 ? payload.length : 126;
      if (payload.length >= 126) header.writeUInt16BE(payload.length, 2);
      socket.write(Buffer.concat([header, payload]));
    };
    let buffer: Buffer = Buffer.alloc(0);
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        const shortLength = buffer[1] & 0x7f;
        assert.notEqual(shortLength, 127, "fixture only expects small CLI frames");
        const headerSize = shortLength === 126 ? 4 : 2;
        if (buffer.length < headerSize + 4) return;
        const length = shortLength === 126 ? buffer.readUInt16BE(2) : shortLength;
        if (buffer.length < headerSize + 4 + length) return;
        const mask = buffer.subarray(headerSize, headerSize + 4);
        const payload = Buffer.from(buffer.subarray(headerSize + 4, headerSize + 4 + length));
        buffer = buffer.subarray(headerSize + 4 + length);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        if (opcode === 8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        assert.equal(opcode, 1);
        const message = decodeClientMessage(payload.toString());
        requests.push(message);
        if (message._tag === "ping") send({ _tag: "pong", nonce: message.nonce });
        if (message._tag === "add_worktree") {
          if (registration === "closed") {
            socket.destroy();
            return;
          }
          // A refusal for somebody else's request must not abort this registration.
          send({
            _tag: "worktree_result",
            requestId: "unrelated",
            result: { status: "error", detail: "not yours" },
          });
          send({
            _tag: "worktree_result",
            requestId: message.requestId,
            result:
              registration === "refused"
                ? { status: "error", detail: "Main folder must be added first" }
                : {
                    status: "ready",
                    folder: message.folder,
                    path: registration === "wrong-path" ? message.folder : message.path,
                    branch: "linked",
                  },
          });
        }
        if (message._tag === "create_session") {
          const cursor = {
            cwd: message.cwd,
            sessionId: "portable-session",
            generation: "generation",
            sequence: 1,
          };
          send({
            _tag: "selected",
            selectionId: message.selectionId,
            cwd: message.cwd,
            sessionId: "portable-session",
            hosted: true,
            cursor,
            snapshot: {
              messages: [],
              dialogs: [],
              state: { sessionId: "portable-session", isStreaming: false },
            },
          });
          send({
            _tag: "session",
            selectionId: message.selectionId,
            cursor: { ...cursor, sequence: 2 },
            event: {
              _tag: "submission",
              submission: {
                id: 1,
                inputId: message.selectionId,
                inputFingerprint: "proof",
                outcome: "started",
              },
            },
          });
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/ws`;
  return { url, requests, origins };
}

test("CLI registers a canonical linked worktree before dispatch, preserves defaults and prints a handle/link", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  const result = await run([f.prompt, f.alias], p.url, {
    GIT_DIR: join(f.main, ".git"),
    GIT_WORK_TREE: f.main,
  });
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.creation, "created");
  assert.equal(json.submission, "started");
  assert.equal(json.cwd, f.linked);
  assert.equal(json.worktreeOf, f.main);
  assert.equal(json.link, `${origin}/s/portable-session`);
  assert.equal(json.handle.sessionId, "portable-session");
  const mutations = p.requests.filter(
    (m) => m._tag === "add_worktree" || m._tag === "create_session",
  );
  assert.deepEqual(
    mutations.map((m) => m._tag),
    ["add_worktree", "create_session"],
  );
  assert.equal(mutations[0]._tag, "add_worktree");
  if (mutations[0]._tag === "add_worktree") {
    assert.equal(mutations[0].folder, f.main);
    assert.equal(mutations[0].path, f.linked);
  }
  assert.equal(mutations[1]._tag, "create_session");
  if (mutations[1]._tag === "create_session") {
    assert.deepEqual(mutations[1].options, {});
    assert.equal(mutations[1].text, "Reply with exactly: PORTABLE");
  }
  assert.ok(p.requests.some((m) => m._tag === "ack" && m.deliveryId === 2));
  assert.deepEqual(p.origins, [origin, origin]);
});

test("register-only distinguishes main checkout, non-Git and linked worktree without creating sessions", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  for (const cwd of [f.main, f.plain, f.alias]) {
    const result = await run(["--register-only", cwd], p.url);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      registered: cwd === f.alias,
      cwd: cwd === f.alias ? f.linked : cwd,
      folder: cwd === f.alias ? f.main : null,
    });
  }
  assert.equal(p.requests.filter((m) => m._tag === "add_worktree").length, 1);
  assert.equal(p.requests.filter((m) => m._tag === "create_session").length, 0);
});

test("registration refusal, lost reply and mismatched identity prevent creation and release the unused out file", async (t) => {
  const f = fixture(t);
  for (const mode of ["refused", "closed", "wrong-path"] as const) {
    const p = await peer(t, mode);
    const out = join(f.dir, `${mode}.json`);
    const result = await run([f.prompt, f.linked, out], p.url);
    assert.equal(result.code, 4, result.stderr);
    assert.match(result.stderr, /Refusing to create a session/);
    assert.equal(p.requests.filter((m) => m._tag === "create_session").length, 0);
    assert.equal(existsSync(out), false);
  }
});

test("explicit flags override env, save full JSON exclusively and forward model/effort", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  const out = join(f.dir, "start.json");
  const args = [
    f.prompt,
    f.main,
    out,
    "--model",
    "provider/model",
    "--thinkingLevel",
    "low",
    "--ws-url",
    p.url,
    "--origin",
    origin,
  ];
  const result = await run(args, "invalid", { PIANO_SESSION_ORIGIN: "invalid" });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), JSON.parse(result.stdout));
  const create = p.requests.find((m) => m._tag === "create_session");
  assert.ok(create?._tag === "create_session");
  assert.deepEqual(create.options, { model: "provider/model", thinkingLevel: "low" });
  const before = p.requests.length;
  const again = await run(args, p.url);
  assert.equal(again.code, 3);
  assert.match(again.stderr, /exists/);
  assert.equal(p.requests.length, before);
});

test("invalid configuration, input and linked subdirectories fail before network side effects", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  for (const extra of [
    ["--thinkingLevel", "extreme"],
    ["--model", "bare-id"],
    ["--ws-url", "wss://public.example/ws"],
    ["--origin", `${origin}/`],
    ["--unknown"],
  ]) {
    const result = await run([f.prompt, f.linked, ...extra], p.url);
    assert.equal(result.code, 2, result.stderr);
  }
  writeFileSync(f.prompt, "  \n");
  assert.equal((await run([f.prompt, f.linked], p.url)).code, 2);
  const subdir = join(f.linked, "subdirectory");
  mkdirSync(subdir);
  const result = await run(["--register-only", subdir], p.url);
  assert.equal(result.code, 4);
  assert.match(result.stderr, /worktree root/);
  assert.deepEqual(p.requests, []);
});
