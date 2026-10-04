import assert from "node:assert/strict";
import { test } from "node:test";
import { Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { NodeServices } from "@effect/platform-node";
import type { SessionEvent } from "../shared/wire.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

const fakeCli = { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] };
const TestLayer = PiSessionsLive.pipe(Layer.provide(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer), Effect.provideService(PiCli, fakeCli)));

const collectUntil = (events: Stream.Stream<SessionEvent>, pred: (e: SessionEvent) => boolean) =>
  events.pipe(Stream.takeUntil(pred), Stream.runCollect, Effect.map((c) => [...c]));

const step = (...a: unknown[]) => { if (process.env.PIANO_DEBUG) console.error("[test]", ...a); };

test("snapshot first, then a streamed turn", async () => {
  const seen = await run(Effect.gen(function* () {
    const sessions = yield* PiSessions;
    const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s1", model: "fake/alpha" });
    step("opened");
    const collector = yield* collectUntil(t.events, (e) => e._tag === "message_end" && e.message.role === "assistant").pipe(Effect.forkChild);
    step("collector forked");
    yield* Effect.sleep("50 millis"); // let the subscriber take its snapshot before the turn starts
    yield* t.act({ _tag: "prompt", text: "hello" });
    step("prompted");
    const events = yield* Fiber.join(collector);
    step("collected", events.length);
    return events;
  }).pipe(Effect.scoped));
  step("scope closed");
  assert.equal(seen[0]._tag, "snapshot");
  assert.equal((seen[0] as Extract<SessionEvent, { _tag: "snapshot" }>).snapshot.state.model, "fake/alpha");
  const tags = seen.map((e) => e._tag);
  assert.ok(tags.includes("message_update"), "streams partials");
  const last = seen[seen.length - 1] as Extract<SessionEvent, { _tag: "message_end" }>;
  assert.equal(last.message.text, "echo: hello");
});

test("canonical context updates after a response and compaction while still running", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "live" });
    assert.equal((yield* t.state).context?.tokens, 0, "initial authoritative stats");
    const ready = yield* Deferred.make<void>();
    const collector = yield* t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
      Stream.takeUntil((e) => e._tag === "dialog" && e.dialog.id === "live1"),
      Stream.runCollect, Effect.forkChild,
    );
    yield* Deferred.await(ready);
    yield* t.act({ _tag: "prompt", text: "live context" });
    const events = yield* Fiber.join(collector);
    assert.ok(events.some((e) => e._tag === "state" && e.state.isStreaming && e.state.context?.tokens === 42000), "publishes latest canonical context before settlement");
    assert.equal((yield* t.state).context?.percent, 21);
    const compactReady = yield* Deferred.make<void>();
    const compacted = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(compactReady, undefined) : Effect.void),
    ), (e) => e._tag === "dialog" && e.dialog.id === "live2").pipe(Effect.forkChild);
    yield* Deferred.await(compactReady);
    yield* t.act({ _tag: "answer", id: "live1", value: "continue" });
    yield* Fiber.join(compacted);
    const state = yield* t.state;
    assert.equal(state.isStreaming, true);
    assert.deepEqual(state.context, { tokens: null, contextWindow: 200000, percent: null }, "does not retain pre-compaction usage or substitute an estimate");
  }).pipe(Effect.timeout("5 seconds"), Effect.scoped));
});

test("model switch refreshes the authoritative context window", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "context-model" });
    assert.equal((yield* t.state).context?.contextWindow, 200000);
    yield* t.act({ _tag: "set_model", model: "fake/beta" });
    assert.equal((yield* t.state).context?.contextWindow, 400000);
  }).pipe(Effect.scoped));
});

test("late subscriber sees transcript and a retained dialog; answering resolves it", async () => {
  const result = await run(Effect.gen(function* () {
    const sessions = yield* PiSessions;
    const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s2" });
    const first = yield* collectUntil(t.events, (e) => e._tag === "dialog").pipe(Effect.forkChild);
    yield* Effect.sleep("50 millis");
    yield* t.act({ _tag: "prompt", text: "ask me" });
    yield* Fiber.join(first);
    // A second client attaches after the dialog was raised.
    const late = yield* collectUntil(t.events, (e) => e._tag === "snapshot").pipe(Effect.map((es) => es[0]));
    const snap = (late as Extract<SessionEvent, { _tag: "snapshot" }>).snapshot;
    const after = yield* collectUntil(t.events, (e) => e._tag === "state" && !e.state.isStreaming).pipe(Effect.forkChild);
    yield* Effect.sleep("50 millis"); // let the collector subscribe before acting
    yield* t.act({ _tag: "answer", id: snap.dialogs[0].id, value: "42" });
    const events = yield* Fiber.join(after);
    return { snap, events, state: yield* t.state };
  }).pipe(Effect.scoped));
  assert.equal(result.snap.dialogs.length, 1);
  assert.equal(result.snap.dialogs[0].method, "input");
  assert.equal(result.snap.messages.length, 1, "user message already in transcript");
  assert.ok(result.events.some((e) => e._tag === "dialog_resolved"));
  assert.ok(result.events.some((e) => e._tag === "notice" && e.message.includes("42")));
  assert.equal(result.state.isStreaming, false);
});

test("model switch and child crash", async () => {
  const result = await run(Effect.gen(function* () {
    const sessions = yield* PiSessions;
    const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s3" });
    yield* t.act({ _tag: "set_model", model: "fake/beta" });
    yield* t.act({ _tag: "set_thinking_level", level: "high" });
    const { model, thinkingLevel } = yield* t.state;
    const closed = yield* collectUntil(t.events, (e) => e._tag === "closed").pipe(Effect.forkChild);
    yield* t.act({ _tag: "prompt", text: "crash now" }).pipe(Effect.ignore);
    const events = yield* Fiber.join(closed);
    const failed = yield* t.act({ _tag: "abort" }).pipe(Effect.flip);
    return { model, thinkingLevel, events, failed };
  }).pipe(Effect.scoped));
  assert.equal(result.model, "fake/beta");
  assert.equal(result.thinkingLevel, "high");
  const closed = result.events[result.events.length - 1] as Extract<SessionEvent, { _tag: "closed" }>;
  assert.equal(closed._tag, "closed");
  assert.match(closed.reason, /code 3/);
  assert.equal(result.failed.reason, "exited");
});

test("probe reports models and default", async () => {
  const r = await run(Effect.gen(function* () {
    return yield* (yield* PiSessions).probe(process.cwd());
  }));
  assert.equal(r.models.length, 2);
  assert.equal(r.defaultModel, "fake/alpha");
});

test("releasing a session tells subscribers it closed", async () => {
  const events = await run(Effect.gen(function* () {
    const sessions = yield* PiSessions;
    const scope = yield* Scope.make();
    const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s4" }).pipe(Scope.provide(scope));
    const collector = yield* collectUntil(t.events, (e) => e._tag === "closed").pipe(Effect.forkChild);
    yield* Effect.sleep("50 millis");
    yield* Scope.close(scope, Exit.succeed(undefined));
    return yield* Fiber.join(collector).pipe(Effect.timeoutOption("5 seconds"));
  }));
  assert.equal(events._tag, "Some", "subscriber saw the stream end");
  const last = events.value[events.value.length - 1] as Extract<SessionEvent, { _tag: "closed" }>;
  assert.equal(last._tag, "closed");
  assert.equal(last.reason, "released");
});
