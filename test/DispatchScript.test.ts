import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const existingCwd = "/srv/piano/existing";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "piano-dispatch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, "work dir");
  mkdirSync(cwd);
  const prompt = join(dir, "prompt.txt");
  writeFileSync(prompt, "Reply with exactly: PORTABLE");
  return { dir, cwd, prompt };
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
async function peer(t: TestContext) {
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
        // One existing session, "portable-session", running in `existingCwd`; Piano refuses a
        // read of "refused-session" for capacity.
        if (message._tag === "session_status" && "sessionId" in message.target)
          send({
            _tag: "session_status",
            requestId: message.requestId,
            result:
              message.target.sessionId === "refused-session"
                ? { status: "error", detail: "Client input capacity is full." }
                : message.target.sessionId === "portable-session"
                  ? {
                      status: "ready",
                      sessions: [
                        {
                          sessionId: "portable-session",
                          cwd: existingCwd,
                          projectId: null,
                          disposition: "running",
                          since: null,
                          needs: null,
                          lastAnswer: null,
                          changes: null,
                        },
                      ],
                    }
                  : { status: "unlisted", detail: "Piano does not list this session." },
          });
        if (message._tag === "select") {
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
            sessionId: message.sessionId,
            hosted: true,
            cursor,
            snapshot: {
              messages: [],
              dialogs: [],
              state: { sessionId: "portable-session", isStreaming: true },
            },
          });
        }
        if (
          message._tag === "act" &&
          (message.action._tag === "prompt" || message.action._tag === "steer")
        )
          send({
            _tag: "session",
            selectionId: message.selectionId,
            cursor: {
              cwd: existingCwd,
              sessionId: "portable-session",
              generation: "generation",
              sequence: 2,
            },
            event: {
              _tag: "submission",
              submission: { id: 2, inputId: message.action.inputId, outcome: "queued" },
            },
          });
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

test("CLI dispatches the prompt file to the resolved directory with Piano's defaults and prints a handle/link", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  const result = await run([f.prompt, f.cwd], p.url);
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.creation, "created");
  assert.equal(json.submission, "started");
  assert.equal(json.cwd, f.cwd);
  assert.equal(json.link, `${origin}/s/portable-session`);
  assert.equal(json.handle.sessionId, "portable-session");
  assert.deepEqual([json.model, json.thinkingLevel], [null, null]);
  const creates = p.requests.filter((m) => m._tag === "create_session");
  assert.equal(creates.length, 1, "create_session is sent exactly once");
  assert.ok(creates[0]._tag === "create_session");
  assert.equal(creates[0].cwd, f.cwd);
  assert.deepEqual(creates[0].options, {});
  assert.equal(creates[0].text, "Reply with exactly: PORTABLE");
  assert.deepEqual(p.origins, [origin]);
});

test("explicit flags override env, save full JSON exclusively and forward model/effort", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  const out = join(f.dir, "start.json");
  const args = [
    f.prompt,
    f.cwd,
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
  assert.equal(
    p.requests.length,
    before,
    "an existing output file stops the dispatch before any network side effect",
  );
});

test("a Piano that cannot be reached reports and records a start that was not sent", async (t) => {
  const f = fixture(t);
  // A loopback port nothing listens on: the WebSocket never opens.
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = (closed.address() as { port: number }).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  const out = join(f.dir, "start.json");
  const result = await run([f.prompt, f.cwd, out], `ws://127.0.0.1:${port}/ws`);
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.deepEqual(
    [json.creation, json.submission, json.handle, json.link],
    ["refused", "not_sent", null, null],
  );
  assert.match(json.detail, /not sent/);
  assert.deepEqual(
    JSON.parse(readFileSync(out, "utf8")),
    json,
    "the file records the same outcome",
  );
});

test("invalid configuration and input fail before network side effects and reserve no output file", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  const out = join(f.dir, "never.json");
  for (const extra of [
    ["--thinkingLevel", "extreme"],
    ["--model", "bare-id"],
    ["--ws-url", "wss://public.example/ws"],
    ["--origin", `${origin}/`],
    ["--unknown"],
  ]) {
    const result = await run([f.prompt, f.cwd, out, ...extra], p.url);
    assert.equal(result.code, 2, result.stderr);
  }
  assert.equal((await run([f.prompt, join(f.dir, "missing"), out], p.url)).code, 2);
  writeFileSync(f.prompt, "  \n");
  assert.equal((await run([f.prompt, f.cwd, out], p.url)).code, 2);
  assert.equal(existsSync(out), false);
  assert.deepEqual(p.requests, []);
});

test("CLI follows up on a session Piano lists, in its directory, and prints Pi's handling", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  for (const [extra, delivery, action] of [
    [[], "follow-up", "prompt"],
    [["--steer"], "steer", "steer"],
  ] as const) {
    const result = await run(["follow-up", "portable-session", f.prompt, ...extra], p.url);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      sessionId: "portable-session",
      delivery,
      submission: "queued",
      link: `${origin}/s/portable-session`,
    });
    const act = p.requests.filter((m) => m._tag === "act").at(-1);
    assert.ok(act?._tag === "act");
    assert.equal(act.action._tag, action);
    assert.ok(act.action._tag === "prompt" || act.action._tag === "steer");
    assert.equal(act.action.text, "Reply with exactly: PORTABLE");
    const select = p.requests.filter((m) => m._tag === "select").at(-1);
    assert.ok(select?._tag === "select");
    assert.equal(select.cwd, existingCwd, "the session is addressed in Piano's directory");
  }
  assert.equal(p.requests.filter((m) => m._tag === "act").length, 2);
});

test("a follow-up to an unknown session or with a blank prompt sends nothing", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  const unknown = await run(["follow-up", "missing-session", f.prompt], p.url);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /does not list/);
  writeFileSync(f.prompt, "  \n");
  assert.equal((await run(["follow-up", "portable-session", f.prompt], p.url)).code, 2);
  assert.equal((await run(["status", "portable-session", "--steer"], p.url)).code, 2);
  assert.deepEqual(
    p.requests.filter((m) => m._tag !== "session_status" && m._tag !== "ping"),
    [],
  );
});

test("a status read Piano refuses is an unexpected failure, not an unknown session", async (t) => {
  const f = fixture(t);
  const p = await peer(t);
  for (const args of [
    ["status", "refused-session"],
    ["follow-up", "refused-session", f.prompt],
  ]) {
    const result = await run(args, p.url);
    assert.equal(result.code, 1, `${args[0]}: ${result.stderr}`);
    assert.match(result.stderr, /capacity is full/);
  }
  assert.deepEqual(
    p.requests.filter((m) => m._tag !== "session_status" && m._tag !== "ping"),
    [],
  );
});
