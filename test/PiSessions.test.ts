import assert from "node:assert/strict";
import { test } from "node:test";
import { Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { NodeServices } from "@effect/platform-node";
import { decodeClientMessage, type Attachment, type SessionEvent } from "../shared/wire.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiRequestTimeoutMs, PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

const fakeCli = { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] };
const TestLayer = PiSessionsLive.pipe(Layer.provide(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer), Effect.provideService(PiCli, fakeCli)));

const collectUntil = <E>(events: Stream.Stream<SessionEvent, E>, pred: (e: SessionEvent) => boolean) =>
  events.pipe(Stream.takeUntil(pred), Stream.runCollect, Effect.map((c) => [...c]));

const step = (...a: unknown[]) => { if (process.env.PIANO_DEBUG) console.error("[test]", ...a); };

test("snapshot first, then a streamed turn", async () => {
  const seen = await run(Effect.gen(function* () {
    const sessions = yield* PiSessions;
    const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s1", model: "fake/alpha" });
    step("opened");
    const ready = yield* Deferred.make<void>();
    const collector = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
    ), (e) => e._tag === "state" && !e.state.isStreaming).pipe(Effect.forkChild);
    step("collector forked");
    yield* Deferred.await(ready);
    yield* t.act({ _tag: "prompt", text: "hello" });
    step("prompted");
    const events = yield* Fiber.join(collector);
    step("collected", events.length);
    assert.equal((yield* t.state).submission?.outcome, "started");
    assert.equal((yield* t.state).isStreaming, false, "acceptance must not reactivate a completed run");
    return events;
  }).pipe(Effect.timeout("5 seconds"), Effect.scoped));
  step("scope closed");
  assert.equal(seen[0]._tag, "snapshot");
  assert.equal((seen[0] as Extract<SessionEvent, { _tag: "snapshot" }>).snapshot.state.model, "fake/alpha");
  const tags = seen.map((e) => e._tag);
  assert.ok(tags.includes("message_update"), "streams partials");
  const reply = seen.find((e) => e._tag === "message_end" && e.message.role === "assistant");
  assert.ok(reply && reply._tag === "message_end");
  assert.equal(reply.message.text, "echo: hello");
});

const image: Attachment = { kind: "image", name: "pixel.png", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=" };

test("image-only prompts reach Pi and survive authoritative refresh and late snapshots without embedding bytes", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "images" });
    yield* t.act({ _tag: "prompt", text: "", attachments: [image] });
    const events = yield* collectUntil(t.events, e => e._tag === "snapshot");
    const event = events[0];
    assert.ok(event._tag === "snapshot");
    const user = event.snapshot.messages.find(m => m.role === "user");
    assert.equal(user?.text, "");
    assert.match(user?.attachments?.[0].url ?? "", /^\/api\/image-previews\/[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(event).includes(image.data), false, "image history cannot exhaust WS snapshot limits");
    const invalid = yield* t.act({ _tag: "prompt", text: "bad image", attachments: [{ ...image, mimeType: "image/jpeg" }] }).pipe(Effect.flip);
    assert.equal(invalid.reason, "rejected");
    yield* t.act({ _tag: "prompt", text: "ask me" });
    const busy = yield* t.act({ _tag: "steer", text: "image", attachments: [image] }).pipe(Effect.flip);
    assert.match(busy.detail, /Wait for Pi/);
  }).pipe(Effect.timeout("5 seconds"), Effect.scoped));
});

test("upload wire rejects unsupported kinds, oversized payloads and malformed base64", () => {
  const command = (attachments: unknown) => JSON.stringify({ _tag: "create_session", selectionId: "s", cwd: "/tmp", options: {}, text: "", attachments });
  assert.deepEqual(decodeClientMessage(command([image]))._tag, "create_session");
  for (const attachments of [
    [{ ...image, kind: "file" }], [{ ...image, mimeType: "image/svg+xml" }],
    [{ ...image, data: "not base64" }], [{ ...image, data: "" }],
    Array(5).fill(image), [{ ...image, data: "A".repeat(4 * Math.ceil(5 * 1024 * 1024 / 3) + 4) }],
  ]) assert.throws(() => decodeClientMessage(command(attachments)));
});

test("handled input acknowledges consumption without starting work or inventing history", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "handled" });
    const ready = yield* Deferred.make<void>();
    const collector = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
    ), (e) => e._tag === "submission" && e.submission.outcome === "handled").pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    yield* t.act({ _tag: "prompt", text: "/handled" });
    const events = yield* Fiber.join(collector);
    assert.equal(events.some((e) => e._tag === "message_end"), false);
    const state = yield* t.state;
    assert.equal(state.submission?.outcome, "handled");
    assert.equal(state.isStreaming, false);
    assert.equal(state.model, "fake/beta", "reconcile extension-command state from Pi");
    assert.equal(state.thinkingLevel, "high");
  }).pipe(Effect.timeout("5 seconds"), Effect.scoped));
});

test("canonical context updates after a response and compaction while still running", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "live" });
    assert.equal((yield* t.state).context?.tokens, 0, "initial authoritative stats");
    const ready = yield* Deferred.make<void>();
    let sawDialog = false, sawUsage = false;
    const collector = yield* t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
      Stream.takeUntil((e) => {
        if (e._tag === "dialog" && e.dialog.id === "live1") sawDialog = true;
        if (e._tag === "state" && e.state.context?.tokens === 42000) sawUsage = true;
        return sawDialog && sawUsage;
      }),
      Stream.runCollect, Effect.forkChild,
    );
    yield* Deferred.await(ready);
    yield* t.act({ _tag: "prompt", text: "live context" });
    const events = yield* Fiber.join(collector);
    assert.ok(events.some((e) => e._tag === "state" && e.state.isStreaming && e.state.context?.tokens === 42000), "publishes latest canonical context before settlement");
    assert.equal((yield* t.state).context?.percent, 21);
    const compactReady = yield* Deferred.make<void>();
    let sawCompactedDialog = false, sawCompactedUsage = false;
    const compacted = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(compactReady, undefined) : Effect.void),
    ), (e) => {
      if (e._tag === "dialog" && e.dialog.id === "live2") sawCompactedDialog = true;
      if (e._tag === "state" && e.state.context?.tokens === null) sawCompactedUsage = true;
      return sawCompactedDialog && sawCompactedUsage;
    }).pipe(Effect.forkChild);
    yield* Deferred.await(compactReady);
    const dialog = events.find((e) => e._tag === "dialog");
    assert.ok(dialog?._tag === "dialog");
    yield* t.act({ _tag: "answer", id: "live1", generation: dialog.dialog.generation, value: "continue" });
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
    const ready = yield* Deferred.make<void>();
    const first = yield* collectUntil(t.events.pipe(Stream.tap(e => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void)), (e) => e._tag === "dialog").pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    yield* t.act({ _tag: "prompt", text: "ask me" });
    yield* Fiber.join(first);
    // A second client attaches after the dialog was raised.
    const late = yield* collectUntil(t.events, (e) => e._tag === "snapshot").pipe(Effect.map((es) => es[0]));
    const snap = (late as Extract<SessionEvent, { _tag: "snapshot" }>).snapshot;
    const answerReady = yield* Deferred.make<void>();
    const after = yield* collectUntil(t.events.pipe(Stream.tap(e => e._tag === "snapshot" ? Deferred.succeed(answerReady, undefined) : Effect.void)), (e) => e._tag === "state" && !e.state.isStreaming).pipe(Effect.forkChild);
    yield* Deferred.await(answerReady);
    yield* t.act({ _tag: "answer", id: snap.dialogs[0].id, generation: snap.dialogs[0].generation, value: "42" });
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
  assert.ok(result.events.some((e) => e._tag === "message_end" && e.message.text === "crash now"), "output already read before exit is not discarded");
  assert.equal(result.failed.reason, "exited");
});

test("Pi's steering and follow-up queues remain paused after abort and can be restored without starting work", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "queue" });
    const ready = yield* Deferred.make<void>();
    const queued = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
    ), (e) => e._tag === "queue_update" && e.messages.length === 4).pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    yield* t.act({ _tag: "prompt", text: "ask queue" });
    yield* t.act({ _tag: "prompt", text: "expand queue" });
    yield* t.act({ _tag: "prompt", text: "duplicate" });
    yield* t.act({ _tag: "prompt", text: "duplicate" });
    yield* t.act({ _tag: "steer", text: "expand queue" });
    const observed = yield* Fiber.join(queued).pipe(Effect.timeoutOption("2 seconds"));
    assert.equal(observed._tag, "Some", "Pi's queue_update must reach session subscribers");
    const expected = [
      { kind: "steering", text: "expanded steering" },
      { kind: "follow-up", text: "expanded follow-up" },
      { kind: "follow-up", text: "duplicate" },
      { kind: "follow-up", text: "duplicate" },
    ];
    assert.deepEqual((yield* t.state).queuedMessages, expected, "show Pi's expanded text, including duplicates, not a client-side guess");
    const late = yield* t.events.pipe(Stream.take(1), Stream.runCollect);
    assert.equal(late[0]._tag, "snapshot");
    if (late[0]._tag === "snapshot") assert.deepEqual(late[0].snapshot.state.queuedMessages, expected);
    yield* t.act({ _tag: "steer", text: "handled queue" });
    assert.equal((yield* t.state).submission?.outcome, "handled");
    yield* t.act({ _tag: "steer", text: "reject queue" }).pipe(Effect.flip);
    assert.equal((yield* t.state).submission?.outcome, "rejected");
    assert.deepEqual((yield* t.state).queuedMessages, expected, "handled/rejected input does not create phantom queue entries");
    const drainReady = yield* Deferred.make<void>();
    const drained = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(drainReady, undefined) : Effect.void),
    ), (e) => e._tag === "state" && !e.state.isStreaming).pipe(Effect.forkChild);
    yield* Deferred.await(drainReady);
    yield* t.act({ _tag: "abort" });
    const events = yield* Fiber.join(drained);
    assert.deepEqual((yield* t.state).queuedMessages, expected, "abort leaves Pi's queue paused");
    assert.equal(events.filter((e) => e._tag === "message_end" && e.message.role === "user" && e.message.text === "duplicate").length, 0, "abort must not automatically resend pending input");
    const restoreReady = yield* Deferred.make<void>();
    const cleared = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(restoreReady, undefined) : Effect.void),
    ), (e) => e._tag === "queue_update" && e.messages.length === 0).pipe(Effect.forkChild);
    yield* Deferred.await(restoreReady);
    const result = yield* t.act({ _tag: "restore_queue" });
    assert.deepEqual(result, { _tag: "queue_restored", messages: expected }, "return Pi's text to the requesting caller, including duplicates");
    const restoreEvents = yield* Fiber.join(cleared);
    assert.deepEqual((yield* t.state).queuedMessages, []);
    assert.equal((yield* t.state).isStreaming, false);
    assert.equal(restoreEvents.some((e) => e._tag === "message_end"), false, "restoring does not create history or model work");
    assert.deepEqual(yield* t.act({ _tag: "restore_queue" }), { _tag: "queue_restored", messages: [] }, "an empty queue restores nothing");
  }).pipe(Effect.timeout("5 seconds"), Effect.scoped));
});

test("busy input preserves extension commands and retry/compaction remain active after agent_end", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "activity" });
    // Each observation is installed before its action, including immediate transitions.
    const actUntil = (text: string, pred: (e: SessionEvent) => boolean) => Effect.gen(function* () {
      const ready = yield* Deferred.make<void>();
      const collector = yield* collectUntil(t.events.pipe(
        Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
      ), pred).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      const result = yield* t.act({ _tag: "prompt", text }).pipe(Effect.result);
      const events = yield* Fiber.join(collector);
      return { result, events };
    });
    yield* actUntil("ask queue", (e) => e._tag === "dialog");
    yield* actUntil("expand queue", (e) => e._tag === "submission" && e.submission.outcome === "queued");
    assert.deepEqual((yield* t.state).queuedMessages, [{ kind: "follow-up", text: "expanded follow-up" }]);
    yield* actUntil("/handled", (e) => e._tag === "submission" && e.submission.outcome === "handled");
    assert.equal((yield* t.state).model, "fake/beta", "busy commands go through prompt, not follow_up");
    yield* actUntil("/retry", (e) => e._tag === "state" && !!e.state.isRetrying);
    assert.equal((yield* t.state).isStreaming, true, "agent_end is not settlement");
    yield* actUntil("/compact", (e) => e._tag === "state" && !!e.state.isCompacting);
    assert.equal((yield* t.state).isStreaming, true);
    assert.equal((yield* t.state).isRetrying, true, "independent facts may overlap");
    const rejected = yield* actUntil("ordinary input during compaction", (e) => e._tag === "submission" && e.submission.outcome === "rejected");
    assert.equal(rejected.result._tag, "Failure");
    assert.match((yield* t.state).submission?.detail ?? "", /compaction/);
    assert.equal(rejected.events.some((e) => e._tag === "message_end"), false, "no synthetic history on rejection");
    yield* actUntil("/summary-retry", (e) => e._tag === "notice" && e.message.includes("Retrying summary"));
    yield* actUntil("/recover", (e) => e._tag === "state" && !e.state.isStreaming && !e.state.isCompacting && !e.state.isRetrying);
    const state = yield* t.state;
    assert.equal(state.isStreaming, false);
    assert.equal(state.isCompacting, false);
    assert.equal(state.isRetrying, false);
    assert.deepEqual(state.queuedMessages, []);
  }).pipe(Effect.timeout("5 seconds"), Effect.scoped));
});

test("missing acknowledgement is delivery-uncertain, never retried; a late response cannot undo newer handling", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "uncertain" });
    const ready = yield* Deferred.make<void>();
    const collector = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
    ), (e) => e._tag === "submission" && e.submission.outcome === "uncertain").pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    const error = yield* t.act({ _tag: "prompt", text: "withhold acknowledgement" }).pipe(Effect.flip);
    assert.equal(error.reason, "timeout");
    const events = yield* Fiber.join(collector);
    assert.equal(events.filter((e) => e._tag === "notice" && e.message.includes("without acknowledging")).length, 1, "write the input once");
    const state = yield* t.state;
    assert.equal(state.submission?.outcome, "uncertain");
    assert.equal(state.isStreaming, true, "uncertain acceptance is not fictional settlement");
    yield* t.act({ _tag: "prompt", text: "/release-ack" });
    assert.equal((yield* t.state).submission?.outcome, "handled");
    assert.equal((yield* t.state).submission?.id, 2);
    assert.equal((yield* t.state).isStreaming, true);
    const snapshot = yield* t.events.pipe(Stream.take(1), Stream.runCollect);
    assert.equal(snapshot[0]._tag, "snapshot");
    if (snapshot[0]._tag === "snapshot") assert.equal(snapshot[0].snapshot.state.submission?.outcome, "handled");
  }).pipe(Effect.provideService(PiRequestTimeoutMs, 500), Effect.timeout("5 seconds"), Effect.scoped));
});

test("submission acknowledgement outlives its disconnected caller", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "disconnect-submit" });
    const ready = yield* Deferred.make<void>();
    const received = yield* Deferred.make<void>();
    const collector = yield* collectUntil(t.events.pipe(Stream.tap((e) =>
      e._tag === "snapshot" ? Deferred.succeed(ready, undefined)
        : e._tag === "notice" && e.message.includes("without acknowledging") ? Deferred.succeed(received, undefined) : Effect.void,
    )), (e) => e._tag === "submission" && e.submission.outcome === "uncertain").pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    const callerScope = yield* Scope.make();
    yield* t.act({ _tag: "prompt", text: "withhold acknowledgement" }).pipe(Effect.forkIn(callerScope));
    yield* Deferred.await(received);
    yield* Scope.close(callerScope, Exit.void);
    yield* Fiber.join(collector);
    assert.equal((yield* t.state).submission?.outcome, "uncertain", "disconnect must not strand the acknowledgement as submitting forever");
    assert.equal((yield* t.state).isStreaming, true, "caller disconnect does not abort work");
  }).pipe(Effect.provideService(PiRequestTimeoutMs, 500), Effect.timeout("5 seconds"), Effect.scoped));
});

test("a delayed command state observation cannot revert a newer model change", async () => {
  await run(Effect.gen(function* () {
    const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "late-state" });
    const ready = yield* Deferred.make<void>();
    const captured = yield* collectUntil(t.events.pipe(
      Stream.tap((e) => e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
    ), (e) => e._tag === "notice" && e.message.includes("old state response")).pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    const oldCommand = yield* t.act({ _tag: "prompt", text: "/hold-state" }).pipe(Effect.forkChild);
    yield* Fiber.join(captured);
    yield* t.act({ _tag: "set_model", model: "fake/beta" });
    assert.equal((yield* t.state).model, "fake/beta");
    yield* t.act({ _tag: "prompt", text: "/release-state" });
    yield* Fiber.join(oldCommand);
    assert.equal((yield* t.state).model, "fake/beta");
    assert.equal((yield* t.state).submission?.id, 2, "older completion does not replace the latest submission");
  }).pipe(Effect.timeout("5 seconds"), Effect.scoped));
});

test("open and probe return a typed readiness timeout even while the child stays alive", async () => {
  for (const operation of ["open", "probe"] as const) {
    await run(Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const error = yield* (operation === "open"
        ? sessions.open({ cwd: process.cwd(), sessionId: "silent-startup" }).pipe(Effect.flip)
        : sessions.probe(process.cwd()).pipe(Effect.flip));
      assert.equal(error.reason, "timeout", `${operation} must not wait for child exit after its readiness deadline`);
      assert.match(error.detail, /get_state/);
    }).pipe(
      Effect.provideService(PiCli, { ...fakeCli, extraArgs: ["--silence-readiness"] }),
      Effect.provideService(PiRequestTimeoutMs, 200), Effect.timeout("2 seconds"), Effect.scoped,
    ));
  }
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
