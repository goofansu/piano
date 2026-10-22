// Locked CLI discovery/UI compatibility without model calls or developer resources.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { applySessionEvent, emptySnapshot } from "../shared/sessionProjection.ts";
import type { Snapshot } from "../shared/wire.ts";
import { createPiCompatibilityFixture } from "./fixtures/PiCompatibility.ts";

test("real Pi loads project-only virtual models and retained supported UI from the selected cwd", async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel("disabled");
  const cwd = fixture.project("projection-models");
  writeFileSync(
    join(cwd, ".pi", "extensions", "projection.ts"),
    `export default function(pi) {
    pi.registerVirtualModel({ provider: 'phase3', id: 'auto', name: 'Project-only router', thinkingLevels: ['low','high'], contextWindow: 1000, maxTokens: 128,
      route() { throw new Error('This no-model fixture must not route a request'); }
    });
    pi.registerCommand('phase3-state', { handler: async (_args, ctx) => {
      await pi.setModel(ctx.modelRegistry.find('phase3', 'auto'));
      pi.setThinkingLevel('high');
      ctx.ui.setStatus('projection', 'real status');
      ctx.ui.setWidget('projection', ['real widget'], { placement: 'belowEditor' });
      ctx.ui.setTitle('real extension title');
      ctx.ui.setEditorText('real editor request');
      ctx.ui.notify('PHASE3_READY');
    } });
  }`,
  );
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        const global = yield* sessions.probe(fixture.root);
        const project = yield* sessions.probe(cwd);
        assert.equal(
          global.models.some((model) => model.provider === "phase3"),
          false,
        );
        assert.equal(
          project.models.some((model) => model.provider === "phase3" && model.id === "auto"),
          true,
        );
        assert.equal(
          global.commands.some((command) => command.name === "phase3-state"),
          false,
        );
        assert.ok(
          project.commands.some(
            (command) => command.name === "phase3-state" && command.source === "extension",
          ),
        );
        const session = yield* sessions.open({ cwd, sessionId: "real-projection" });
        const commands = yield* session.commands;
        assert.ok(commands.some((command) => command.name === "phase3-state"));
        const ready = yield* Deferred.make<void>();
        const observed = yield* session.events.pipe(
          Stream.tap((event) =>
            event._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
          Stream.takeUntil((event) => event._tag === "notice" && event.message === "PHASE3_READY"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(ready);
        yield* session.act({ _tag: "prompt", text: "/phase3-state" });
        yield* Fiber.join(observed);
        const state = yield* session.state;
        assert.equal(state.model, "phase3/auto");
        assert.equal(state.thinkingLevel, "high");
        assert.deepEqual(state.extension?.statuses, [{ key: "projection", text: "real status" }]);
        assert.deepEqual(state.extension?.widgets, [
          { key: "projection", lines: ["real widget"], placement: "belowEditor" },
        ]);
        assert.equal(state.extension?.title, "real extension title");
        assert.equal(state.extension?.editorRequest?.text, "real editor request");
        const snapshot = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
        if (snapshot[0]._tag === "snapshot")
          assert.deepEqual(snapshot[0].snapshot.state.extension, state.extension);
      }).pipe(
        Effect.timeout("20 seconds"),
        Effect.scoped,
        Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
        Effect.provideService(PiCli, fixture.cli()),
      ),
    );
    assert.equal(fixture.observe().requests.length, 0);
  } finally {
    await fixture.close();
  }
});

test("INV-01/05/12: real Pi startup emits exactly 100 unique rows across history and live records", async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel("disabled");
  const cwd = fixture.project("startup-history");
  writeFileSync(
    join(cwd, ".pi", "extensions", "startup-history.ts"),
    `export default function(pi) {
    pi.on('session_start', async (_event, ctx) => {
      for (let i = 0; i < 100; i++) {
        pi.sendMessage({ customType: 'startup', content: 'STARTUP-' + i, display: true });
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      ctx.ui.setStatus('startup', 'STARTUP-FINISHED');
      ctx.ui.notify('STARTUP-FINISHED');
    });
  }`,
  );
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessionId = "real-startup-history";
        const session = yield* (yield* PiSessions).open({ cwd, sessionId });
        const snapshots = yield* session.events.pipe(
          Stream.scan(() => emptySnapshot(sessionId), applySessionEvent),
          Stream.takeUntil(
            (snapshot) =>
              snapshot.state.extension?.statuses.some(
                (status) => status.text === "STARTUP-FINISHED",
              ) === true && !snapshot.state.projectionError,
          ),
          Stream.runCollect,
        );
        const final = snapshots.at(-1)!;
        assert.equal(final.messages.length, 100);
        assert.deepEqual(
          final.messages.map((message) => message.text),
          Array.from({ length: 100 }, (_, i) => `STARTUP-${i}`),
        );
        assert.equal(new Set(final.messages.map((message) => message.id)).size, 100);
        // A later authoritative refresh must not shift the live IDs.
        const ready = yield* Deferred.make<void>();
        const refresh = yield* session.events.pipe(
          Stream.tap((event) =>
            event._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
          Stream.filter((event) => event._tag === "context"),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(ready);
        yield* session.act({ _tag: "prompt", text: "/phase0-facts" });
        const context = (yield* Fiber.join(refresh))[0];
        assert.equal(context._tag, "context");
        if (context._tag === "context") assert.deepEqual(context.messages, final.messages);
      }).pipe(
        Effect.timeout("20 seconds"),
        Effect.scoped,
        Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
        Effect.provideService(PiCli, fixture.cli()),
      ),
    );
    assert.equal(fixture.observe().requests.length, 0);
  } finally {
    await fixture.close();
  }
});

test("INV-01/12: a saved peek is the Snapshot real Pi opens the same file with", async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel("disabled");
  const cwd = fixture.project("saved-peek");
  const secret = "sk-file-canary-123456789";
  // Compaction, a context edit and an abandoned branch: Pi's context rules decide both views.
  const manager = SessionManager.create(cwd, fixture.sessionDir);
  manager.appendModelChange("piano-phase0", "global");
  manager.appendThinkingLevelChange("low");
  manager.appendSessionInfo("saved peek");
  manager.appendMessage({ role: "user", content: "old prompt", timestamp: 1 });
  const reply = manager.appendMessage({
    role: "assistant",
    api: "openai-completions",
    provider: "piano-phase0",
    model: "global",
    content: [{ type: "text", text: `original ${secret}` }],
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 2,
  });
  manager.appendMessage({ role: "user", content: "abandoned branch", timestamp: 3 });
  manager.branch(reply);
  manager.appendContextEdit(reply, { content: `edited ${secret}` });
  manager.appendCompaction("summary", reply, 30);
  const sessionId = manager.getSessionId();
  const sessionFile = manager.getSessionFile()!;
  // The facts both views establish from Pi; live run, host and statistics fields are the open's own.
  const facts = ({ state, messages, dialogs }: Snapshot) => ({
    state: {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      sessionName: state.sessionName,
      model: state.model,
      thinkingLevel: state.thinkingLevel,
      isStreaming: state.isStreaming,
    },
    messages,
    dialogs,
  });
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        const saved = yield* sessions.history.peek(sessionId, sessionFile);
        const session = yield* sessions.open({ cwd, sessionId, sessionFile });
        const opened = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
        assert.equal(opened[0]._tag, "snapshot");
        if (opened[0]._tag !== "snapshot") return;
        assert.deepEqual(facts(saved), facts(opened[0].snapshot));
        assert.deepEqual(
          saved.messages.map((message) => message.text),
          ["summary", "edited [REDACTED]"],
        );
      }).pipe(
        Effect.timeout("20 seconds"),
        Effect.scoped,
        Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
        Effect.provideService(PiCli, fixture.cli()),
      ),
    );
    assert.equal(fixture.observe().requests.length, 0);
  } finally {
    await fixture.close();
  }
});
