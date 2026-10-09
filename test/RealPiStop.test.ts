// INV-01/03: real Pi 1.1 tool cancellation must not consume queued steering.
// Local model only; no credentials or credits. Complements native dialog abort coverage.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Layer, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

test("real Pi Stop takes tool-wait steering and follow-up without consuming or running them", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "piano-real-stop-"));
  const agentDir = join(scratch, "agent");
  mkdirSync(agentDir);
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume scratch request */ }
    requests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({
      id: "scratch", object: "chat.completion.chunk", created: 0, model: "local",
      choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_hold", type: "function", function: { name: "hold_tool", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
    })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
    "piano-test": {
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, api: "openai-completions", apiKey: "scratch-not-a-credential",
      models: [{ id: "local", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    },
  } }));
  const extension = join(scratch, "fixture.ts");
  writeFileSync(extension, `export default function(pi) {
    pi.on("cache_warming_decision", () => ({ action: "stop" }));
    pi.registerTool({ name: "hold_tool", label: "Hold", description: "Wait until cancelled",
      parameters: { type: "object", properties: {} },
      async execute(_id, _params, signal, onUpdate) {
        onUpdate({ content: [{ type: "text", text: "TOOL_RUNNING" }], details: undefined });
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
        return { content: [{ type: "text", text: "Wait cancelled" }], details: undefined };
      }
    });
  }`);
  const shim = join(scratch, "real-pi.mjs");
  const cli = new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url).href;
  writeFileSync(shim, `for(const key of Object.keys(process.env))if(key!=="PATH")delete process.env[key];
process.env.HOME=${JSON.stringify(scratch)};
process.env.PI_CODING_AGENT_DIR=${JSON.stringify(agentDir)};
process.env.PI_OFFLINE="1";
await import(${JSON.stringify(cli)});`);
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: scratch, sessionId: "real-stop", model: "piano-test/local" });
      const ready = yield* Deferred.make<void>();
      const working = yield* Deferred.make<void>();
      const settled = yield* Deferred.make<void>();
      let stopping = false;
      yield* session.events.pipe(Stream.tap(event => Effect.gen(function* () {
        if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
        if (event._tag === "tool_update" && event.tool.text.includes("TOOL_RUNNING")) yield* Deferred.succeed(working, undefined);
        if (stopping && event._tag === "state" && !event.state.isStreaming) yield* Deferred.succeed(settled, undefined);
      })), Stream.runDrain, Effect.forkChild);
      yield* Deferred.await(ready);
      yield* session.act({ _tag: "prompt", text: "hold" });
      yield* Deferred.await(working);
      yield* session.act({ _tag: "steer", text: "queued steering" });
      yield* session.act({ _tag: "prompt", text: "queued follow-up" });
      stopping = true;
      const restored = yield* session.act({ _tag: "stop" });
      yield* Deferred.await(settled);
      // Bounded observation catches late continuation after the first idle frame.
      yield* Effect.sleep(300);
      const [snapshot] = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      assert.equal(snapshot._tag, "snapshot");
      if (snapshot._tag !== "snapshot") return;
      assert.deepEqual(snapshot.snapshot.messages.filter(m => m.role === "user").map(m => m.text), ["hold"], "Stop must not consume queued input into aborted history");
      assert.deepEqual(restored, { _tag: "queue_restored", messages: [{ kind: "steering", text: "queued steering" }, { kind: "follow-up", text: "queued follow-up" }] });
      assert.deepEqual(snapshot.snapshot.state.queuedMessages, []);
      assert.equal(snapshot.snapshot.state.isStreaming, false);
      assert.equal(requests, 1, "Stop must not auto-run queued work");
      console.log("Real Pi tool-wait Stop: queue returned, history contains only hold, model requests=1");
    }).pipe(
      Effect.timeout("15 seconds"), Effect.scoped,
      Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
      Effect.provideService(PiCli, { node: process.execPath, cli: shim, extraArgs: ["--extension", extension, "--tools", "hold_tool", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve", "--offline"] }),
    ));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(scratch, { recursive: true, force: true });
  }
});
