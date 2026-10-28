import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { DirectoryFacts, DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { PiCli, type PiCliConfig } from "../server/PiCli.ts";
import { type PiSession, PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import type { SessionEvent, SessionState } from "../shared/wire.ts";

const cli = {
  node: process.execPath,
  cli: new URL("./fake-projection-pi.mjs", import.meta.url).pathname,
  extraArgs: [],
};
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions>, selectedCli: PiCliConfig = cli) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
      Effect.provideService(PiCli, selectedCli),
    ),
  );
const snapshot = (session: PiSession) =>
  session.events.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map((es) => {
      assert.equal(es[0]._tag, "snapshot");
      return (es[0] as Extract<SessionEvent, { _tag: "snapshot" }>).snapshot;
    }),
  );
const observe = (session: PiSession, text: string, projected?: (e: SessionEvent) => boolean) =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<void>();
    let sawBarrier = false,
      sawProjection = !projected;
    const observed = yield* session.events.pipe(
      Stream.tap((e) => (e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void)),
      Stream.takeUntil((e) => {
        if (e._tag === "notice" && e.message === "barrier " + text) sawBarrier = true;
        if (projected?.(e)) sawProjection = true;
        return sawBarrier && sawProjection;
      }),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Deferred.await(ready);
    yield* session.act({ _tag: "prompt", text });
    return yield* Fiber.join(observed);
  });

test("content-indexed endings replace drafts and cumulative usage is not added", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "projection",
      });
      const events = yield* observe(session, "/partial");
      const updates = events.filter((e) => e._tag === "message_update");
      const last = updates.at(-1)!;
      assert.equal(last.message.text, "first corrected \n\nsecond corrected");
      assert.deepEqual(
        last.message.toolCalls?.map((c) => [c.id, c.args]),
        [
          ["parent", '{\n  "code": "correct"\n}'],
          ["other", ""],
        ],
      );
      assert.equal(last.message.usage?.totalTokens, 13);
      assert.equal((yield* snapshot(session)).pending?.text, last.message.text);
      yield* session.act({ _tag: "set_thinking_level", level: "max" });
      assert.equal(
        (yield* session.state).thinkingLevel,
        "low",
        "read back a clamp even without an event",
      );
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("assistant text blocks stay separate through streaming, completion and readback", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "text-blocks",
      });
      const events = yield* observe(session, "/text-blocks");
      const partial = events.findLast((e) => e._tag === "message_update");
      assert.ok(partial?._tag === "message_update");
      assert.equal(
        partial.message.text,
        "home unchanged.\n\nThe key invariant",
        "separate blocks, not deltas; empty and thinking blocks add no spacing",
      );
      const final = events.find((e) => e._tag === "message_end");
      assert.ok(final?._tag === "message_end");
      assert.equal(final.message.text, "home unchanged.\n\nThe key invariant");
      assert.equal((yield* snapshot(session)).messages[0].text, final.message.text);
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("readback replies of the wrong shape surface as refresh errors and recover, never as defects", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "projection",
      });
      const settledState = (pred: (state: SessionState) => boolean) =>
        Effect.gen(function* () {
          for (;;) {
            const state = yield* session.state;
            if (pred(state)) return state;
            yield* Effect.sleep("20 millis");
          }
        });
      yield* observe(session, "/readbacks-malformed");
      const failed = yield* settledState((s) => s.statsRefreshError !== undefined);
      assert.equal(
        failed.projectionError,
        "Current context refresh failed: Pi returned an invalid session state.",
      );
      assert.equal(
        failed.stateRefreshError,
        "Session state refresh failed: Pi returned an invalid session state.",
      );
      assert.equal(
        failed.statsRefreshError,
        "Usage refresh failed: Pi returned invalid session statistics.",
      );
      assert.equal(failed.model, "router/auto", "a malformed readback keeps the last facts");
      yield* observe(session, "/refresh-recover");
      const recovered = yield* settledState((s) => s.statsRefreshError === undefined);
      assert.equal(recovered.projectionError, undefined);
      assert.equal(recovered.stateRefreshError, undefined);
      assert.equal(recovered.cost, 1.23);
      // Once preflight succeeds, an invalid full history must still surface and recover.
      yield* observe(session, "/history-malformed");
      assert.equal(
        (yield* settledState((s) => s.projectionError !== undefined)).projectionError,
        "Current context refresh failed: Pi returned an invalid message history.",
      );
      yield* observe(session, "/refresh-recover");
      yield* settledState((s) => s.projectionError === undefined);
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("safe live/reload output retains tools and extension state without inventing transcript or usage", async () => {
  const secret = "P3SecretCanary-123456789";
  process.env.PIANO_TEST_SECRET = secret;
  try {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: "safe-projection",
        });
        yield* observe(session, "/partial");
        const partial = yield* observe(session, "/secret");
        assert.ok(
          !JSON.stringify(partial).includes(secret.slice(0, 12)),
          "hold a known-secret prefix across chunks",
        );
        assert.ok(
          !JSON.stringify(yield* snapshot(session)).includes(secret.slice(0, 12)),
          "partial reload uses the same protection",
        );
        const events = yield* observe(session, "/finish");
        assert.ok(!JSON.stringify(events).includes(secret));
        const snap = yield* snapshot(session);
        assert.ok(!JSON.stringify(snap).includes(secret));
        assert.equal(snap.state.model, "router/auto");
        const reply = snap.messages.find((m) => m.role === "assistant")!;
        assert.equal(reply.model, "physical/answer");
        assert.equal(reply.thinkingLevel, "high");
        assert.match(reply.text, /^FINAL corrected \[REDACTED\]/);
        assert.equal(reply.usage?.totalTokens, 15);
        assert.equal(
          snap.messages.filter((m) => m.role === "tool_result").length,
          1,
          "nested execution is not another transcript result",
        );
        assert.equal(snap.messages.find((m) => m.role === "tool_result")?.usage?.totalTokens, 18);
        assert.equal(
          snap.state.tokens?.total,
          150,
          "Pi full-session totals are independent of context messages and previews",
        );
        assert.equal(snap.state.cost, 1.23);
        const nested = events
          .filter((e) => e._tag === "tool_update")
          .filter((e) => e.tool.id === "parent/1");
        assert.equal(
          nested.at(-2)?.tool.text,
          "latest preview",
          "partialResult is latest update, not unconditional append",
        );
        assert.equal(nested.at(-1)?.tool.text, "nested final [REDACTED]");
        assert.equal(nested.at(-1)?.tool.parentId, "parent");
        assert.deepEqual(
          snap.tools?.map((tool) => tool.id).sort(),
          ["parent", "parent/1"],
          "current-context executions, including nested output, survive reattachment",
        );
        assert.equal(
          snap.messages.find((m) => m.role === "tool_result")?.nestedCalls?.[0].status,
          "success",
          "Pi persists ok, not success",
        );
        assert.match(snap.state.extension?.statuses[0].text ?? "", /Projection ready/);
        assert.match(
          snap.state.extension?.widgets[0].lines[0] ?? "",
          /<script>/,
          "markup remains inert data for the renderer",
        );
        assert.match(snap.state.extension?.editorRequest?.text ?? "", /Suggested follow-up/);
        yield* observe(session, "/clear");
        assert.deepEqual((yield* snapshot(session)).state.extension?.statuses, []);
        assert.deepEqual((yield* snapshot(session)).state.extension?.widgets, []);
        // Readback no longer blocks protocol consumption: a subsequent Pi notify
        // is not a barrier for the host's asynchronous authoritative projection.
        yield* observe(
          session,
          "/compact",
          (e) =>
            e._tag === "context" &&
            e.messages[0]?.text === "Authoritative compacted context [REDACTED]",
        );
        const compacted = yield* snapshot(session);
        assert.deepEqual(
          compacted.messages.map((m) => m.text),
          ["Authoritative compacted context [REDACTED]"],
        );
        assert.deepEqual(
          compacted.tools,
          [],
          "compaction releases executions whose owning calls left the context",
        );
        yield* observe(
          session,
          "/edit-context",
          (e) => e._tag === "context" && e.messages[0]?.text === "Authoritative context edit",
        );
        assert.deepEqual(
          (yield* snapshot(session)).messages.map((m) => m.text),
          ["Authoritative context edit"],
        );
        yield* observe(session, "/select-secret");
        const dialog = (yield* snapshot(session)).dialogs[0];
        assert.deepEqual(dialog.options, ["[REDACTED]"]);
        const optionReady = yield* Deferred.make<void>();
        const optionReceived = yield* session.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(optionReady, undefined) : Effect.void,
          ),
          Stream.takeUntil((e) => e._tag === "notice" && e.message === "original option received"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(optionReady);
        yield* session.act({
          _tag: "answer",
          id: dialog.id,
          generation: dialog.generation,
          value: "[REDACTED]",
        });
        yield* Fiber.join(optionReceived);
        const error = yield* session.act({ _tag: "prompt", text: "/error" }).pipe(Effect.flip);
        assert.equal(error.detail, "Rejected [REDACTED]");
        const ready = yield* Deferred.make<void>();
        const closed = yield* session.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(ready);
        yield* session.act({ _tag: "prompt", text: "/crash" }).pipe(Effect.ignore);
        assert.ok(
          !JSON.stringify(yield* Fiber.join(closed)).includes(secret),
          "exit and stderr are projected too",
        );
      }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
    );
  } finally {
    delete process.env.PIANO_TEST_SECRET;
  }
});

test("catalog observations and caches belong to the requested cwd", async () => {
  const tmp = realpathSync(tmpdir()),
    root = mkdtempSync(join(tmp, "piano-catalog-"));
  try {
    await run(
      Effect.gen(function* () {
        const facts = yield* DirectoryFacts;
        const home = yield* facts.catalog(tmp);
        const project = yield* facts.catalog(root);
        assert.equal(project.cwd, root);
        assert.equal(project.models[0].name, root);
        assert.equal(home.cwd, tmp);
        assert.equal(home.models[0].name, tmp);
        assert.equal((yield* facts.catalog(root)).models[0].name, root);
      }).pipe(Effect.provide(DirectoryFactsLive), Effect.scoped),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
