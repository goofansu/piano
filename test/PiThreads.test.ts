import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Fiber, Layer, Scope, Stream } from "effect";
import { NodeServices } from "@effect/platform-node";
import type { ThreadEvent } from "../shared/wire.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiThreads, PiThreadsLive } from "../server/PiThreads.ts";

const fakeCli = { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] };
const TestLayer = PiThreadsLive.pipe(Layer.provide(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, PiThreads>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer), Effect.provideService(PiCli, fakeCli)));

const collectUntil = (events: Stream.Stream<ThreadEvent>, pred: (e: ThreadEvent) => boolean) =>
  events.pipe(Stream.takeUntil(pred), Stream.runCollect, Effect.map((c) => [...c]));

const step = (...a: unknown[]) => { if (process.env.PIANO_DEBUG) console.error("[test]", ...a); };

test("snapshot first, then a streamed turn", async () => {
  const seen = await run(Effect.gen(function* () {
    const threads = yield* PiThreads;
    const t = yield* threads.open({ cwd: process.cwd(), sessionId: "s1", model: "fake/alpha" });
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
  assert.equal((seen[0] as Extract<ThreadEvent, { _tag: "snapshot" }>).snapshot.state.model, "fake/alpha");
  const tags = seen.map((e) => e._tag);
  assert.ok(tags.includes("message_update"), "streams partials");
  const last = seen[seen.length - 1] as Extract<ThreadEvent, { _tag: "message_end" }>;
  assert.equal(last.message.text, "echo: hello");
});

test("late subscriber sees transcript and a retained dialog; answering resolves it", async () => {
  const result = await run(Effect.gen(function* () {
    const threads = yield* PiThreads;
    const t = yield* threads.open({ cwd: process.cwd(), sessionId: "s2" });
    const first = yield* collectUntil(t.events, (e) => e._tag === "dialog").pipe(Effect.forkChild);
    yield* Effect.sleep("50 millis");
    yield* t.act({ _tag: "prompt", text: "ask me" });
    yield* Fiber.join(first);
    // A second client attaches after the dialog was raised.
    const late = yield* collectUntil(t.events, (e) => e._tag === "snapshot").pipe(Effect.map((es) => es[0]));
    const snap = (late as Extract<ThreadEvent, { _tag: "snapshot" }>).snapshot;
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
    const threads = yield* PiThreads;
    const t = yield* threads.open({ cwd: process.cwd(), sessionId: "s3" });
    yield* t.act({ _tag: "set_model", model: "fake/beta" });
    const model = (yield* t.state).model;
    const closed = yield* collectUntil(t.events, (e) => e._tag === "closed").pipe(Effect.forkChild);
    yield* t.act({ _tag: "prompt", text: "crash now" }).pipe(Effect.ignore);
    const events = yield* Fiber.join(closed);
    const failed = yield* t.act({ _tag: "abort" }).pipe(Effect.flip);
    return { model, events, failed };
  }).pipe(Effect.scoped));
  assert.equal(result.model, "fake/beta");
  const closed = result.events[result.events.length - 1] as Extract<ThreadEvent, { _tag: "closed" }>;
  assert.equal(closed._tag, "closed");
  assert.match(closed.reason, /code 3/);
  assert.equal(result.failed.reason, "exited");
});

test("probe reports models and default", async () => {
  const r = await run(Effect.gen(function* () {
    return yield* (yield* PiThreads).probe(process.cwd());
  }));
  assert.equal(r.models.length, 2);
  assert.equal(r.defaultModel, "fake/alpha");
});
