// Real installed Pi, isolated HOME/config and a local SSE model: no credentials or model credits.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Layer } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

test("real Pi local API: create, poll done, idle release/history, reopen/send, busy refusal and abort", {
  timeout: 30000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "piano-real-api-"));
  const agent = join(root, "agent");
  mkdirSync(agent);
  let requests = 0;
  const model = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* consume the request */
    }
    requests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const hold = requests === 2;
    response.write(
      `data: ${JSON.stringify({
        id: "local",
        object: "chat.completion.chunk",
        created: 0,
        model: "local",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: hold ? "" : "pong" },
            finish_reason: hold ? null : "stop",
          },
        ],
      })}\n\n`,
    );
    // The second request remains running until API abort cancels the real Pi HTTP request.
    if (!hold) response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  writeFileSync(
    join(agent, "models.json"),
    JSON.stringify({
      providers: {
        "piano-test": {
          baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`,
          api: "openai-completions",
          apiKey: "scratch-not-a-credential",
          models: [
            {
              id: "local",
              reasoning: false,
              input: ["text"],
              contextWindow: 200000,
              maxTokens: 128,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
  const extension = join(root, "no-warming.ts");
  writeFileSync(
    extension,
    'export default function(pi) { pi.on("cache_warming_decision", () => ({ action: "stop" })); }',
  );
  const shim = join(root, "pi.mjs");
  const cli = new URL(
    "../node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
    import.meta.url,
  ).href;
  writeFileSync(
    shim,
    `const sessions = process.env.PI_CODING_AGENT_SESSION_DIR;
for (const key of Object.keys(process.env)) if (key !== "PATH") delete process.env[key];
process.env.HOME = ${JSON.stringify(root)};
process.env.PI_CODING_AGENT_DIR = ${JSON.stringify(agent)};
process.env.PI_CODING_AGENT_SESSION_DIR = sessions;
process.env.PI_OFFLINE = "1";
await import(${JSON.stringify(cli)});`,
  );
  let server: RouterFixture | undefined;
  try {
    server = await startRouter(
      "piano-real-api-router-",
      Layer.succeed(PiCli, {
        node: process.execPath,
        cli: shim,
        extraArgs: [
          "--extension",
          extension,
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-context-files",
          "--no-approve",
          "--offline",
        ],
      }),
      { idleMs: 200 },
    );
    const api = server.api;
    const post = async (path: string, body: unknown, expected = 200) => {
      const response = await api(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result;
    };
    const input = {
      cwd: server.repo,
      model: "piano-test/local",
      prompt: "Reply with exactly: pong",
      requestId: "real-1",
    };
    const started = Date.now();
    const created = await post("/api/v1/sessions", input);
    const createMs = Date.now() - started;
    assert.equal(created.seq, 1);
    assert.deepEqual(await post("/api/v1/sessions", input), created);
    const query = `workspaceId=${created.workspaceId}&sessionId=${created.sessionId}`;
    const read = `/api/v1/sessions?${query}`;
    const until = async (predicate: (body: Record<string, unknown>) => boolean) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const response = await api(read);
        const body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        if (predicate(body)) return body;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail("Real Pi API polling deadline");
    };
    const done = await until((b) => b.status === "idle" && b.completedSeq === 1);
    assert.equal(done.lastAssistantMessage, "pong");
    const released = await until((b) => b.hosted === false);
    assert.equal(released.status, "idle");
    assert.equal(released.lastAssistantMessage, "pong");
    assert.equal(released.seq, 1);
    assert.equal(requests, 1);
    assert.deepEqual(
      await post(`/api/v1/sessions/messages?${query}`, { prompt: "Reply with exactly: pong" }),
      { seq: 2 },
    );
    await until((b) => b.status === "running" && requests === 2);
    await post(`/api/v1/sessions/messages?${query}`, { prompt: "again" }, 409);
    assert.deepEqual(await post(`/api/v1/sessions/abort?${query}`, {}), { ok: true });
    const aborted = await until(
      (b) => b.completedSeq === 2 && (b.status === "idle" || b.status === "error"),
    );
    if (aborted.status === "error") assert.ok(aborted.detail);
    await post(`/api/v1/sessions/abort?${query}`, { stop: true });
    await until((b) => b.hosted === false);
    assert.deepEqual(
      await post(`/api/v1/sessions/messages?${query}`, { prompt: "Reply with exactly: pong" }),
      { seq: 3 },
    );
    const again = await until((b) => b.status === "idle" && b.completedSeq === 3);
    assert.equal(again.lastAssistantMessage, "pong");
    assert.equal(requests, 3);
    console.log(
      `Real Pi API: create=${createMs}ms; pong read back; dedupe, idle release, reopen, busy and abort passed`,
    );
  } finally {
    await server?.dispose();
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
