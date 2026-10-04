// Compatibility check through PiSessions against the locked, real Pi CLI.
// The only fake is a loopback OpenAI-compatible stream; no model credits or credentials.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { NodeServices } from "@effect/platform-node";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

const TestLayer = PiSessionsLive.pipe(Layer.provide(NodeServices.layer));

test("real Pi reports started/queued/handled input; abort and native queue restore add no model request", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "piano-real-queue-"));
  const agentDir = join(scratch, "agent");
  mkdirSync(agentDir);
  let requests = 0;
  const modelServer = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume only the scratch request */ }
    requests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({
      id: "scratch", object: "chat.completion.chunk", created: 0, model: "local",
      choices: [{ index: 0, delta: { role: "assistant", content: "working" }, finish_reason: null }],
    })}\n\n`);
    // Hold the real provider stream until Pi cancels it; no arbitrary timing sleeps.
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const port = (modelServer.address() as { port: number }).port;
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
    "piano-test": {
      baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "scratch-not-a-credential",
      models: [{ id: "local", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    },
  } }));
  const extension = join(scratch, "handled.ts");
  writeFileSync(extension, `export default function(pi) {
    pi.registerCommand("phase1-handled", { handler: async (_args, ctx) => ctx.ui.notify("Handled command fixture") });
    pi.registerCommand("phase2-dialog", { handler: async (_args, ctx) => {
      const value = await ctx.ui.input("Queue abort dialog");
      ctx.ui.notify(value === undefined ? "DIALOG_CANCELLED" : "DIALOG_ANSWERED");
    } });
    pi.on("cache_warming_decision", () => ({ action: "stop" }));
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
      const session = yield* (yield* PiSessions).open({ cwd: scratch, sessionId: "real-queue", model: "piano-test/local" });
      const ready = yield* Deferred.make<void>();
      const working = yield* Deferred.make<void>();
      const queued = yield* session.events.pipe(
        Stream.tap((event) => event._tag === "snapshot" ? Deferred.succeed(ready, undefined)
          : event._tag === "message_update" && event.message.text === "working" ? Deferred.succeed(working, undefined) : Effect.void),
        Stream.takeUntil((event) => event._tag === "queue_update" && event.messages.length === 2),
        Stream.runCollect, Effect.forkChild,
      );
      yield* Deferred.await(ready);
      yield* session.act({ _tag: "prompt", text: "hold" });
      assert.equal((yield* session.state).submission?.outcome, "started");
      yield* Deferred.await(working);
      yield* session.act({ _tag: "prompt", text: "/phase1-handled" });
      assert.equal((yield* session.state).submission?.outcome, "handled", "real extension commands work even while streaming");
      assert.equal((yield* session.state).isStreaming, true, "handled input must not settle independent work");
      yield* session.act({ _tag: "prompt", text: "queued one" });
      yield* session.act({ _tag: "prompt", text: "queued two" });
      assert.equal((yield* session.state).submission?.outcome, "queued");
      yield* Fiber.join(queued);
      const expected = [{ kind: "follow-up", text: "queued one" }, { kind: "follow-up", text: "queued two" }];
      const idleReady = yield* Deferred.make<void>();
      const idle = yield* session.events.pipe(
        Stream.tap((event) => event._tag === "snapshot" ? Deferred.succeed(idleReady, undefined) : Effect.void),
        Stream.takeUntil((event) => event._tag === "state" && !event.state.isStreaming),
        Stream.runCollect, Effect.forkChild,
      );
      yield* Deferred.await(idleReady);
      const dialogReady = yield* Deferred.make<void>();
      const dialog = yield* session.events.pipe(
        Stream.tap(event => event._tag === "snapshot" ? Deferred.succeed(dialogReady, undefined) : Effect.void),
        Stream.takeUntil(event => event._tag === "dialog"), Stream.runCollect, Effect.forkChild,
      );
      yield* Deferred.await(dialogReady);
      const command = yield* session.act({ _tag: "prompt", text: "/phase2-dialog" }).pipe(Effect.forkChild);
      yield* Fiber.join(dialog);
      yield* session.act({ _tag: "abort" });
      yield* Fiber.join(idle); yield* Fiber.join(command);
      assert.equal((yield* session.state).dialogResolution?.reason, "aborted", "native abort plus host cancellation releases a real command dialog before its prompt acknowledgement");
      assert.deepEqual((yield* session.state).queuedMessages, expected, "real Pi leaves the queue paused after abort");
      const clearReady = yield* Deferred.make<void>();
      const cleared = yield* session.events.pipe(
        Stream.tap((event) => event._tag === "snapshot" ? Deferred.succeed(clearReady, undefined) : Effect.void),
        Stream.takeUntil((event) => event._tag === "queue_update" && event.messages.length === 0),
        Stream.runCollect, Effect.forkChild,
      );
      yield* Deferred.await(clearReady);
      assert.deepEqual(yield* session.act({ _tag: "restore_queue" }), { _tag: "queue_restored", messages: expected });
      yield* Fiber.join(cleared);
      assert.deepEqual((yield* session.state).queuedMessages, []);
      assert.equal((yield* session.state).isStreaming, false);
      const snapshot = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      if (snapshot[0]._tag === "snapshot") assert.deepEqual(snapshot[0].snapshot.messages.filter(m => m.role === "user").map(m => m.text), ["hold"]);
      assert.equal(requests, 1, "stop/restore never starts a new model request");
    }).pipe(
      Effect.timeout("15 seconds"), Effect.scoped, Effect.provide(TestLayer),
      Effect.provideService(PiCli, { node: process.execPath, cli: shim, extraArgs: ["--extension", extension, "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve", "--offline"] }),
    ));
  } finally {
    modelServer.closeAllConnections();
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
    rmSync(scratch, { recursive: true, force: true });
  }
});
