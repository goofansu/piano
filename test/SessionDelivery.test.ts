import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Queue, type Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { makeDelivery, makeSocketDelivery, socketLimits } from "../server/BoundedDelivery.ts";
import { PiCli } from "../server/PiCli.ts";
import { type PiSession, PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { makeSessionPublication } from "../server/SessionPublication.ts";
import type { SessionEvent, SessionFrame } from "../shared/wire.ts";

test("delivery byte budgets fail oversized frames and retained backlogs without blocking the producer", async () => {
  for (const [values, oversized] of [
    [["x".repeat(65)], true],
    [["x".repeat(40), "y".repeat(40)], false],
  ] as const) {
    await Effect.runPromise(
      Effect.gen(function* () {
        const delivery = yield* makeDelivery<string>({ messages: 256, bytes: 64 });
        for (const value of values) yield* delivery.offer(value);
        const error = yield* delivery.failure.pipe(Effect.flip);
        assert.equal(error._tag, "DeliveryOverflow");
        assert.equal(error.oversized, oversized);
        const result = yield* delivery.stream.pipe(Stream.runCollect, Effect.result);
        assert.equal(
          result._tag,
          "Failure",
          "overflow cannot silently drain as a healthy completed delivery",
        );
      }).pipe(Effect.timeout("1 second")),
    );
  }
});

// A fake socket: `written` holds each frame the delivery wrote, as "<deliveryId>:<value>".
const socket = (limits: Partial<typeof socketLimits> = {}) =>
  Effect.gen(function* () {
    const writes = yield* Queue.unbounded<string>();
    const written: string[] = [];
    const delivery = yield* makeSocketDelivery(
      (text: string) => Queue.offer(writes, text).pipe(Effect.asVoid),
      (value: string, id) => `${id}:${value}`,
      { ...socketLimits, ackTimeout: "1 second", ...limits },
    );
    // Wait for the frames the window should allow by now, then give a writer that should be
    // blocked a moment to write more: a fixed sleep alone loses the race on a loaded machine.
    const expectWritten = (expected: string, message?: string) =>
      Effect.gen(function* () {
        const count = expected === "" ? 0 : expected.split(",").length;
        while (written.length < count) {
          const text = yield* Queue.take(writes).pipe(Effect.timeoutOption("1 second"));
          if (text._tag === "None") break;
          written.push(text.value);
        }
        yield* Effect.sleep("20 millis");
        written.push(...(yield* Queue.clear(writes)));
        assert.equal(written.map((t) => t.split(":")[0]).join(","), expected, message);
      });
    return { delivery, expectWritten };
  });

const scoped = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(work.pipe(Effect.scoped, Effect.timeout("5 seconds")));

test("INV-05: the socket window holds unacknowledged frames and cumulative acks release them in order", () =>
  scoped(
    Effect.gen(function* () {
      const { delivery, expectWritten } = yield* socket({ window: { frames: 2, bytes: 1024 } });
      for (const value of ["a", "b", "c", "d", "e", "f"]) yield* delivery.offer(value);
      yield* expectWritten("1,2", "a saturated window stops writing");
      yield* delivery.ack(99); // never written: no credit
      yield* expectWritten("1,2");
      yield* delivery.ack(2); // out of order and cumulative: acknowledges 1 and 2
      yield* expectWritten("1,2,3,4");
      yield* delivery.ack(1);
      yield* delivery.ack(2); // stale: no extra credit
      yield* expectWritten("1,2,3,4");
      yield* delivery.ack(3);
      yield* expectWritten("1,2,3,4,5");
      yield* delivery.ack(5);
      yield* expectWritten("1,2,3,4,5,6");
      assert.equal(
        yield* delivery.closed.pipe(
          Effect.timeoutOption("20 millis"),
          Effect.map((o) => o._tag),
        ),
        "None",
        "acknowledged delivery stays open",
      );
    }),
  ));

test("INV-05: the socket window also bounds unacknowledged bytes", () =>
  scoped(
    Effect.gen(function* () {
      const { delivery, expectWritten } = yield* socket({ window: { frames: 32, bytes: 12 } });
      for (const value of ["xxxx", "yyyy", "zzzz"]) yield* delivery.offer(value); // 6 bytes per frame
      yield* expectWritten("1,2");
      yield* delivery.ack(1);
      yield* expectWritten("1,2,3");
    }),
  ));

test("INV-05: a missing acknowledgement closes the socket to retry later, even below the window", () =>
  scoped(
    Effect.gen(function* () {
      const { delivery } = yield* socket({ ackTimeout: "50 millis" });
      yield* delivery.offer("a");
      const closed = yield* delivery.closed;
      assert.equal(closed.code, 1013);
      assert.match(closed.reason, /acknowledgement timed out/);
    }),
  ));

test("INV-05: an oversized frame closes as too large and a lagging consumer closes to retry later", () =>
  scoped(
    Effect.gen(function* () {
      const big = yield* socket({ frameBytes: 8, queue: { messages: 256, bytes: 1024 } });
      yield* big.delivery.offer("123456789");
      const tooLarge = yield* big.delivery.closed;
      assert.equal(tooLarge.code, 1009);
      assert.match(tooLarge.reason, /delivery limit/);
      yield* big.expectWritten("", "an oversized frame is never written");
      const lagging = yield* socket({
        window: { frames: 1, bytes: 1024 },
        queue: { messages: 2, bytes: 1024 },
      });
      for (const value of ["a", "b", "c", "d", "e"]) yield* lagging.delivery.offer(value);
      const behind = yield* lagging.delivery.closed;
      assert.equal(behind.code, 1013);
      assert.match(behind.reason, /reconnect for a current snapshot/);
      // The first close reason wins.
      yield* lagging.delivery.close("later", 1000);
      assert.equal((yield* lagging.delivery.closed).code, 1013);
    }),
  ));

test("INV-05: writer failure closes delivery without exposing transport contents or retrying", () =>
  scoped(
    Effect.gen(function* () {
      let attempts = 0;
      const delivery = yield* makeSocketDelivery(
        () =>
          Effect.sync(() => {
            attempts++;
          }).pipe(Effect.andThen(Effect.die("private transport content"))),
        (value: string) => value,
      );
      yield* delivery.offer("first");
      yield* delivery.offer("second");
      const closed = yield* delivery.closed;
      assert.equal(closed.code, 1013);
      assert.match(closed.reason, /reconnect/);
      assert.equal(closed.reason.includes("private transport content"), false);
      assert.equal(attempts, 1);
    }),
  ));

// Kept here so the performance fixture stays with the publication contract it exercises.
const streamingPi = String.raw`
import { createInterface } from 'node:readline';
const out = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const reply = (cmd, data) => out({ type: 'response', command: cmd.type, id: cmd.id, success: true, data });
const sessionId = process.argv[process.argv.indexOf('--session-id') + 1];
const args = { path: 'src/generated.ts', content: 'x'.repeat(128 * 1024) };
const toolCall = { type: 'toolCall', id: 'write', name: 'write', arguments: args };
const message = { role: 'assistant', content: [toolCall], stopReason: 'stop' };
let messages = [], streaming = false;
const delta = (event) => out({ type: 'message_update', assistantMessageEvent: event });
for await (const line of createInterface({ input: process.stdin })) {
  const cmd = JSON.parse(line);
  if (cmd.type === 'get_state') reply(cmd, { sessionId, isStreaming: streaming });
  else if (cmd.type === 'get_messages') reply(cmd, { messages });
  else if (cmd.type === 'get_session_stats') reply(cmd, {});
  else if (cmd.type === 'prompt' && cmd.message === 'secrets') {
    reply(cmd, { disposition: 'started' });
    out({ type: 'agent_start' });
    out({ type: 'message_start', message: { role: 'assistant', content: [] } });
    for (const chunk of ['prefix ca', 't ', 'ca', 'nary-sensitive-', '123456789', ' done']) {
      delta({ type: 'text_delta', contentIndex: 0, delta: chunk });
      out({ type: 'extension_ui_request', method: 'notify', message: 'text barrier' });
    }
    delta({ type: 'toolcall_start', contentIndex: 1, id: 'secret', toolName: 'write' });
    for (const chunk of ['{"content":"ca', 'nary-sensitive-', '123456789', '"}']) {
      delta({ type: 'toolcall_delta', contentIndex: 1, delta: chunk });
      out({ type: 'extension_ui_request', method: 'notify', message: 'argument barrier' });
    }
    const final = { role: 'assistant', stopReason: 'stop', content: [
      { type: 'text', text: 'prefix cat canary-sensitive-123456789 done' },
      { type: 'toolCall', id: 'secret', name: 'write', arguments: { content: 'canary-sensitive-123456789' } },
    ] };
    messages.push(final);
    out({ type: 'message_end', message: final });
    out({ type: 'agent_settled' });
  }
  else if (cmd.type === 'prompt') {
    streaming = true;
    reply(cmd, { disposition: 'started' });
    out({ type: 'agent_start' });
    out({ type: 'message_start', message: { role: 'assistant', content: [] } });
    delta({ type: 'toolcall_start', contentIndex: 0, id: 'write', toolName: 'write' });
    const json = JSON.stringify(args);
    let offset = 0;
    const timer = setInterval(() => {
      delta({ type: 'toolcall_delta', contentIndex: 0, delta: json.slice(offset, offset + 128) });
      offset += 128;
      if (offset >= json.length) {
        clearInterval(timer);
        delta({ type: 'toolcall_end', contentIndex: 0, toolCall });
        messages = [message];
        out({ type: 'message_end', message });
        streaming = false;
        out({ type: 'agent_settled' });
      }
    }, 2);
  } else reply(cmd, {});
}
`;

test("PIN-47: 128KiB tool arguments through PiSessions stay below 5MiB of partial traffic", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "piano-streaming-"));
  process.env.PIANO_TEST_SECRET = "canary-sensitive-123456789";
  try {
    const cli = join(directory, "pi.mjs");
    await writeFile(cli, streamingPi);
    await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({ cwd: directory, sessionId: "traffic" });
        const ready = yield* Deferred.make<void>();
        const watch = yield* session.events.pipe(
          Stream.tap((f) =>
            f._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
          Stream.takeUntil((f) => f._tag === "message_end"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(ready);
        yield* session.act({ _tag: "prompt", text: "generate" });
        const frames = yield* Fiber.join(watch);
        const partials = frames.filter((f) => f._tag === "message_update");
        const bytes = partials.reduce((n, f) => n + Buffer.byteLength(JSON.stringify(f)), 0);
        t.diagnostic(JSON.stringify({ partialFrames: partials.length, partialBytes: bytes }));
        const final = frames.at(-1)!;
        assert.equal(final._tag, "message_end");
        if (final._tag === "message_end") {
          assert.deepEqual(JSON.parse(final.message.toolCalls![0].args), {
            path: "src/generated.ts",
            content: "x".repeat(128 * 1024),
          });
          assert.deepEqual(partials.at(-1)!.message.toolCalls, final.message.toolCalls);
          assert.equal(partials.at(-1)!.message.text, final.message.text);
        }
        contiguous(frames);
        assert.ok(bytes < 5 * 1024 * 1024, `${bytes} partial bytes exceeds the benchmark budget`);

        // Barriers force intermediate safe projections onto the wire even when chunks arrive
        // within one cadence. A masked suffix may later become ordinary visible text.
        const secretReady = yield* Deferred.make<void>();
        const secretWatch = yield* session.events.pipe(
          Stream.tap((f) =>
            f._tag === "snapshot" ? Deferred.succeed(secretReady, undefined) : Effect.void,
          ),
          Stream.takeUntil((f) => f._tag === "message_end"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(secretReady);
        yield* session.act({ _tag: "prompt", text: "secrets" });
        const secretFrames = yield* Fiber.join(secretWatch);
        contiguous(secretFrames);
        assert.ok(!JSON.stringify(secretFrames).includes("canary-sensitive"));
        const updates = secretFrames.filter((f) => f._tag === "message_update");
        assert.ok(updates.some((f) => f.message.text === "prefix [REDACTED]"));
        assert.ok(updates.some((f) => f.message.text === "prefix cat "));
        assert.ok(updates.some((f) => f.message.toolCalls?.[0]?.args === '{"content":"[REDACTED]'));
        const secretFinal = secretFrames.at(-1)!;
        assert.equal(secretFinal._tag, "message_end");
        if (secretFinal._tag === "message_end") {
          assert.equal(secretFinal.message.text, "prefix cat [REDACTED] done");
          assert.deepEqual(JSON.parse(secretFinal.message.toolCalls![0].args), {
            content: "[REDACTED]",
          });
        }
      }).pipe(
        Effect.scoped,
        Effect.timeout("20 seconds"),
        Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
        Effect.provideService(PiCli, { node: process.execPath, cli, extraArgs: [] }),
      ),
    );
  } finally {
    delete process.env.PIANO_TEST_SECRET;
    await rm(directory, { recursive: true, force: true });
  }
});

const partial = (text: string, id = "reply"): SessionEvent => ({
  _tag: "message_update",
  message: { id, role: "assistant", text },
});
const publication = () =>
  makeSessionPublication({
    cwd: process.cwd(),
    sessionId: "coalesced",
    generation: "generation",
    initial: { state: { sessionId: "coalesced", isStreaming: true }, messages: [], dialogs: [] },
  });
const contiguous = (frames: readonly SessionFrame[]) => {
  for (let i = 1; i < frames.length; i++) {
    assert.equal(frames[i].cursor.sequence, frames[i - 1].cursor.sequence + 1);
    assert.equal(frames[i].cursor.generation, frames[0].cursor.generation);
  }
};

test("INV-05: cumulative partials publish on a bounded cadence, not once per delta", () =>
  scoped(
    Effect.gen(function* () {
      const pub = yield* publication();
      const ready = yield* Deferred.make<void>();
      const frames: SessionFrame[] = [];
      yield* pub
        .subscribe((s) => s.state)
        .pipe(
          Stream.runForEach((frame) =>
            Effect.sync(() => frames.push(frame)).pipe(
              Effect.andThen(
                frame._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
              ),
            ),
          ),
          Effect.forkChild,
        );
      yield* Deferred.await(ready);
      for (let i = 1; i <= 25; i++) {
        yield* pub.apply([partial("x".repeat(i))]);
        yield* TestClock.adjust(2);
      }
      assert.equal(frames.length, 2, "25 inputs over 50ms publish one partial");
      assert.equal(frames[1]._tag, "message_update");
      if (frames[1]._tag === "message_update") assert.equal(frames[1].message.text, "x".repeat(25));
      // New objects with the same projected content (e.g. thinking deltas) are no-ops.
      yield* pub.apply([partial("x".repeat(25))]);
      yield* TestClock.adjust(50);
      assert.equal(frames.length, 2);
      yield* pub.apply([partial("latest")]);
      assert.equal((yield* pub.snapshot).pending?.text, "latest", "internal reads stay current");
      const attached = yield* pub.subscribe((s) => s.state).pipe(Stream.take(1), Stream.runCollect);
      assert.equal(attached[0].cursor.sequence, 2, "attach flushes before capturing its cursor");
      assert.equal(attached[0]._tag, "snapshot");
      if (attached[0]._tag === "snapshot")
        assert.equal(attached[0].snapshot.pending?.text, "latest");
      const reconnectReady = yield* Deferred.make<void>();
      const reconnect = yield* pub
        .subscribe((s) => s.state)
        .pipe(
          Stream.tap((f) =>
            f._tag === "snapshot" ? Deferred.succeed(reconnectReady, undefined) : Effect.void,
          ),
          Stream.runCollect,
          Effect.forkChild,
        );
      yield* Deferred.await(reconnectReady);
      // A different message cannot replace an unpublished previous message.
      yield* pub.apply([partial("first", "one"), partial("second", "two")]);
      yield* pub.apply([{ _tag: "closed", closure: { _tag: "released", detail: "done" } }]);
      yield* TestClock.adjust(100);
      const reconnected = yield* Fiber.join(reconnect);
      contiguous(frames);
      contiguous(reconnected);
      assert.equal(reconnected[0].cursor.sequence, attached[0].cursor.sequence);
      assert.deepEqual(reconnected.slice(1), frames.slice(3));
      assert.deepEqual(
        frames.filter((f) => f._tag === "message_update").map((f) => f.message.text),
        ["x".repeat(25), "latest", "first", "second"],
      );
      assert.equal(frames.at(-1)!._tag, "closed");
    }).pipe(Effect.provide(TestClock.layer())),
  ));

test("INV-05: every non-partial event is an immediate barrier and closure cancels pending timers", () =>
  scoped(
    Effect.gen(function* () {
      const pub = yield* publication();
      const ready = yield* Deferred.make<void>();
      const watching = yield* pub
        .subscribe((s) => s.state)
        .pipe(
          Stream.tap((f) =>
            f._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
          Stream.runCollect,
          Effect.forkChild,
        );
      yield* Deferred.await(ready);
      const barriers: SessionEvent[] = [
        { _tag: "message_end", message: { id: "reply", role: "assistant", text: "final" } },
        { _tag: "context", messages: [] },
        {
          _tag: "dialog",
          dialog: {
            id: "dialog",
            generation: "generation",
            receivedAt: 0,
            deadlineAt: 1000,
            deadlineKind: "host-recovery",
            method: "input",
          },
        },
        { _tag: "state", state: { sessionId: "coalesced", isStreaming: true, isStopping: true } },
        { _tag: "state", state: { sessionId: "coalesced", isStreaming: false } },
        { _tag: "closed", closure: { _tag: "released", detail: "done" } },
      ];
      for (const [i, barrier] of barriers.entries()) {
        yield* pub.apply([partial(`old ${i}`), partial(`latest ${i}`), barrier]);
        yield* TestClock.adjust(100);
      }
      const frames = yield* Fiber.join(watching);
      contiguous(frames);
      assert.deepEqual(
        frames.slice(1).map((f) => f._tag),
        barriers.flatMap((b) => ["message_update", b._tag]),
      );
      assert.deepEqual(
        frames.filter((f) => f._tag === "message_update").map((f) => f.message.text),
        barriers.map((_, i) => `latest ${i}`),
      );
      assert.equal((yield* pub.snapshot).pending, undefined);
      yield* pub.apply([partial("late")]);
      yield* TestClock.adjust(100);
      const reconnect = yield* pub.subscribe((s) => s.state).pipe(Stream.runCollect);
      assert.equal(reconnect[0].cursor.sequence, frames.at(-1)!.cursor.sequence);
      assert.equal((yield* pub.snapshot).pending, undefined);
    }).pipe(Effect.provide(TestClock.layer())),
  ));

const run = <A, E>(work: Effect.Effect<A, E, PiSessions | Scope.Scope>) =>
  Effect.runPromise(
    work.pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("./fake-host-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
    ),
  );
const snapshot = (session: PiSession) =>
  session.events.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map((frames) => {
      assert.equal(frames[0]._tag, "snapshot");
      return frames[0] as Extract<SessionFrame, { _tag: "snapshot" }>;
    }),
  );
const prompt = (session: PiSession, text: string) =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<void>();
    const watch = yield* session.events.pipe(
      Stream.tap((e) => (e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void)),
      Stream.takeUntil((e) => e._tag === "notice" && e.message === `barrier ${text}`),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Deferred.await(ready);
    yield* session.act({ _tag: "prompt", text });
    return yield* Fiber.join(watch);
  });

test("INV-05/11: atomic attach identifies partial/tools/dialog/state and all subsequent redacted frames in order", async () => {
  const canary = "sk-sequence-canary-123456789";
  process.env.PIANO_TEST_SECRET = canary;
  try {
    const cursor = await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: "ordered",
        });
        const frames = yield* prompt(session, "/partial");
        for (let n = 1; n < frames.length; n++) {
          assert.equal(frames[n].cursor.sequence, frames[n - 1].cursor.sequence + 1);
          assert.equal(frames[n].cursor.generation, frames[0].cursor.generation);
          assert.equal(frames[n].cursor.cwd, process.cwd());
          assert.equal(frames[n].cursor.sessionId, "ordered");
        }
        yield* prompt(session, "/dialog");
        const attached = yield* snapshot(session);
        assert.match(attached.snapshot.pending!.text, /Partial ordered \[REDACTED\]/);
        assert.equal(attached.snapshot.tools?.[0].status, "running");
        assert.equal(attached.snapshot.dialogs[0].generation, attached.cursor.generation);
        assert.equal(attached.snapshot.state.extension?.statuses[0].text, "Status ordered");
        assert.ok(attached.cursor.sequence >= frames.at(-1)!.cursor.sequence);
        assert.ok(!JSON.stringify([frames, attached]).includes(canary));
        // Attach and mutate concurrently. A fact is either in the snapshot or strictly
        // after its cursor, never an unsequenced partial assembled outside the lock.
        const [observed] = yield* Effect.all(
          [
            session.events.pipe(
              Stream.takeUntil((e) => e._tag === "notice" && e.message === "barrier /partial"),
              Stream.runCollect,
            ),
            session.act({ _tag: "prompt", text: "/partial" }),
          ],
          { concurrency: "unbounded" },
        );
        for (let i = 1; i < observed.length; i++)
          assert.equal(observed[i].cursor.sequence, observed[i - 1].cursor.sequence + 1);
        return attached.cursor;
      }),
    );
    const replacement = await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: "ordered",
        });
        return (yield* snapshot(session)).cursor;
      }),
    );
    assert.notEqual(cursor.generation, replacement.generation);
    assert.ok(
      replacement.sequence < cursor.sequence,
      "a replacement starts a fresh sequence, independently of the previous incarnation",
    );
  } finally {
    delete process.env.PIANO_TEST_SECRET;
  }
});

test("INV-05: a held consumer fails bounded delivery while Pi and a fast subscriber continue; reconnect snapshots current state", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "bounded" });
      const ready = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      const slow = yield* session.events.pipe(
        Stream.runForEach((e) =>
          e._tag === "snapshot"
            ? Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void,
        ),
        Effect.result,
        Effect.forkChild,
      );
      yield* Deferred.await(ready);
      const fastReady = yield* Deferred.make<void>();
      const fast = yield* session.events.pipe(
        Stream.tap((e) =>
          e._tag === "snapshot" ? Deferred.succeed(fastReady, undefined) : Effect.void,
        ),
        Stream.takeUntil((e) => e._tag === "notice" && e.message === "burst complete"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(fastReady);
      yield* session.act({ _tag: "prompt", text: "/burst" });
      const frames = yield* Fiber.join(fast);
      assert.ok(frames.length > 600);
      for (let n = 1; n < frames.length; n++)
        assert.equal(frames[n].cursor.sequence, frames[n - 1].cursor.sequence + 1);
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(slow);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") assert.equal(result.failure._tag, "DeliveryOverflow");
      const latest = yield* snapshot(session);
      assert.ok(latest.cursor.sequence >= frames.at(-1)!.cursor.sequence);
      assert.equal(
        latest.snapshot.state.extension?.statuses.find((s) => s.key === "burst")?.text,
        "burst 600",
      );
      yield* prompt(session, "/after-overflow"); // stdout/commands remain responsive
    }),
  );
});
