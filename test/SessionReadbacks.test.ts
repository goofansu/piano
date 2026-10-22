import assert from "node:assert/strict";
import { test } from "node:test";
import { Deferred, type Duration, Effect, Fiber, Queue, type Scope } from "effect";
import { type PiReadback, type PiRecord, piReadbacks } from "../server/PiRecords.ts";
import { PiSessionError } from "../server/PiTransport.ts";
import { makeSessionPublication } from "../server/SessionPublication.ts";
import { makeSessionReadbacks } from "../server/SessionReadbacks.ts";
import { makeSessionRecordProgress } from "../server/SessionRecordProgress.ts";
import type { RenderMsg, SessionState } from "../shared/wire.ts";

/** One readback Pi has been asked for, answered when the test resolves its raw reply. */
interface PendingRead {
  readonly type: string;
  readonly since?: unknown;
  readonly reply: Deferred.Deferred<unknown, PiSessionError>;
}

const initial: SessionState = {
  sessionId: "readbacks",
  isStreaming: false,
  model: "fake/alpha",
  sessionName: "before",
};

/** The message a context readback publishes, so its landing shows in the snapshot. */
const contextMessage: RenderMsg = { id: "context", role: "user", text: "from Pi's context" };

/** SessionReadbacks over a fake Pi whose reads wait on the test, landing through the session's
 * real SessionPublication and fenced by its real SessionRecordProgress. The test plays the
 * transport (receiving records) and PiSessions (processing them). */
const harness = Effect.fn("harness")(function* (options: { drainDeadline?: Duration.Input } = {}) {
  const scope = yield* Effect.scope;
  const reads = yield* Queue.unbounded<PendingRead>();
  let received = 0;
  let buffered = 0;
  const progress = makeSessionRecordProgress({
    observed: () => received,
    drainDeadline: options.drainDeadline,
  });
  /** Process the oldest received record. */
  const processOne = (record: PiRecord = { type: "future_event" }) =>
    Effect.gen(function* () {
      assert.ok(buffered > 0, "only a received record can be processed");
      buffered--;
      yield* publication.transaction(() => Effect.sync(() => progress.project(record)));
      yield* progress.processed();
    });
  /** Pi sends a record and it is processed. */
  const receiveProcessed = (record?: PiRecord) =>
    Effect.suspend(() => {
      received++;
      buffered++;
      return processOne(record);
    });
  const publication = yield* makeSessionPublication({
    cwd: "/readbacks",
    sessionId: initial.sessionId,
    generation: "test",
    initial: { state: initial, messages: [], dialogs: [] },
  });
  const read = <A>({ command, decode, invalid }: PiReadback<A>) =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<unknown, PiSessionError>();
      yield* Queue.offer(reads, { type: String(command.type), since: command.since, reply });
      const value = decode(yield* Deferred.await(reply));
      if (value === undefined)
        return yield* new PiSessionError({ reason: "protocol", detail: invalid });
      return value;
    });
  const readbacks = makeSessionReadbacks({
    scope,
    read,
    readState: read(piReadbacks.state),
    progress,
    context: () => ({ _tag: "context", messages: [contextMessage] }),
    publication,
  });
  return {
    readbacks,
    state: publication.state,
    /** Whether a context readback has replaced the projected history. */
    contextLanded: Effect.map(publication.snapshot, (snapshot) =>
      snapshot.messages.some((message) => message.id === contextMessage.id),
    ),
    /** A Pi record arrives and is processed: state facts change under the lock. */
    record: (patch: Partial<SessionState>) =>
      publication.patchState(patch).pipe(Effect.andThen(receiveProcessed())),
    /** A Pi record arrives and is processed without a state change; `record` shapes message
     * boundaries. */
    output: receiveProcessed,
    /** A Pi record arrives but is not processed yet. */
    buffer: () => {
      received++;
      buffered++;
    },
    /** Process the oldest received record. */
    process: processOne,
    /** The next readback Pi was asked for, which must be of `type`. */
    next: (type: string) =>
      Effect.gen(function* () {
        const read = yield* Queue.take(reads);
        assert.equal(read.type, type);
        return read;
      }),
    nextRead: Queue.take(reads),
    pending: Queue.size(reads),
    answer: (read: PendingRead, raw: unknown) => Deferred.succeed(read.reply, raw),
    refuse: (read: PendingRead, detail: string) =>
      Deferred.fail(read.reply, new PiSessionError({ reason: "rejected", detail })),
  };
});

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.timeout("5 seconds")));

const rawState = (fields: Record<string, unknown>) => ({
  sessionId: "readbacks",
  isStreaming: false,
  ...fields,
});

test("a state readback started before a name change keeps the newer name", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness();
      const refresh = yield* pi.readbacks
        .refresh("state", pi.readbacks.supersede())
        .pipe(Effect.forkChild);
      const read = yield* pi.next("get_state");
      yield* pi.record({ sessionName: "renamed" });
      yield* pi.answer(
        read,
        rawState({ sessionName: "before", model: { provider: "fake", id: "beta" } }),
      );
      yield* Fiber.join(refresh);
      const state = yield* pi.state;
      assert.equal(state.sessionName, "renamed", "the older readback must not undo the rename");
      assert.equal(state.model, "fake/beta", "facts unchanged since the read still land");
    }),
  );
});

test("a state readback owed to a superseded operation is dropped", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness();
      const refresh = yield* pi.readbacks
        .refresh("state", pi.readbacks.supersede())
        .pipe(Effect.forkChild);
      const read = yield* pi.next("get_state");
      pi.readbacks.supersede();
      yield* pi.answer(read, rawState({ model: { provider: "fake", id: "beta" } }));
      yield* Fiber.join(refresh);
      assert.equal((yield* pi.state).model, "fake/alpha");
    }),
  );
});

test("statistics read before a model switch are dropped", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness();
      const refresh = yield* pi.readbacks.refresh("stats").pipe(Effect.forkChild);
      const stats = yield* pi.next("get_session_stats");
      yield* pi.record({ model: "fake/beta" });
      yield* pi.answer(stats, { cost: 5 });
      yield* Fiber.join(refresh);
      const state = yield* pi.state;
      assert.equal(state.model, "fake/beta");
      assert.equal(state.cost, undefined, "the old model's figures never land");
      assert.equal(state.statsUpdatedAt, undefined);
      assert.equal(state.contextIsLastKnown, true);
    }),
  );
});

test("a context raced by Pi output is read three times, then becomes a projection error", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness();
      const refresh = yield* pi.readbacks.refresh("context").pipe(Effect.forkChild);
      for (let attempt = 0; attempt < 3; attempt++) {
        yield* pi.answer(yield* pi.next("get_state"), rawState({}));
        const read = yield* pi.next("get_messages");
        yield* pi.output();
        yield* pi.answer(read, { messages: [] });
        yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      }
      yield* Fiber.join(refresh);
      assert.equal(yield* pi.pending, 0, "no fourth attempt");
      assert.equal(yield* pi.contextLanded, false, "a raced context is never published");
      assert.equal(
        (yield* pi.state).projectionError,
        "Pi context changed during refresh. This view may be stale until the next command or settled boundary.",
      );

      // The next unraced readback publishes the context and clears the error.
      const retry = yield* pi.readbacks.refresh("context").pipe(Effect.forkChild);
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* pi.answer(yield* pi.next("get_messages"), { messages: [] });
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* Fiber.join(retry);
      assert.ok(yield* pi.contextLanded);
      assert.equal((yield* pi.state).projectionError, undefined);
    }),
  );
});

/** Let a worker that could proceed reach Pi. */
const settleFibers = Effect.gen(function* () {
  for (let i = 0; i < 10; i++) yield* Effect.yieldNow;
});

test("a record received while the context is read blocks replacement until it is processed", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness();
      pi.buffer();
      const refresh = yield* pi.readbacks.refresh("context").pipe(Effect.forkChild);
      yield* settleFibers;
      assert.equal(yield* pi.pending, 0, "Pi is not read before received records are processed");
      // A second record arrives before the first is processed: the drain the refresh waited for
      // ends, but the output it then reads includes a record not yet projected.
      pi.buffer();
      yield* pi.process();
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* pi.answer(yield* pi.next("get_messages"), { messages: [] });
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* settleFibers;
      assert.equal(yield* pi.contextLanded, false, "the read does not land over that record");
      assert.equal(yield* pi.pending, 0, "the retry waits for it too");
      yield* pi.process();
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* pi.answer(yield* pi.next("get_messages"), { messages: [] });
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* Fiber.join(refresh);
      assert.equal(yield* pi.contextLanded, true);
      assert.equal((yield* pi.state).projectionError, undefined);
    }),
  );
});

test("a record never processed fails the context read past the drain deadline", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness({ drainDeadline: "20 millis" });
      pi.buffer();
      yield* pi.readbacks.refresh("context");
      assert.equal(yield* pi.pending, 0, "Pi's context is never read");
      assert.equal(yield* pi.contextLanded, false);
      assert.equal(
        (yield* pi.state).projectionError,
        "Current context refresh failed: Pi records did not drain. Reopen history before continuing.",
      );
    }),
  );
});

test("an open message defers the context read until its end", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness();
      yield* pi.output({ type: "message_start" });
      const refresh = yield* pi.readbacks.refresh("context").pipe(Effect.forkChild);
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* Fiber.join(refresh);
      assert.equal(yield* pi.pending, 0, "Pi's context is not read while a message is open");
      assert.equal(yield* pi.contextLanded, false);
      assert.match((yield* pi.state).projectionError ?? "", /Pi context changed/);

      yield* pi.output({ type: "message_end" });
      const retry = yield* pi.readbacks.refresh("context").pipe(Effect.forkChild);
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* pi.answer(yield* pi.next("get_messages"), { messages: [] });
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* Fiber.join(retry);
      assert.equal(yield* pi.contextLanded, true);
      assert.equal((yield* pi.state).projectionError, undefined);
    }),
  );
});

for (const activeAt of ["preflight", "post-read"]) {
  test(`active ${activeAt} defers without retrying, then a stats boundary recovers pending context`, async () => {
    await run(
      Effect.gen(function* () {
        const pi = yield* harness();
        yield* pi.readbacks.schedule("context", "context");
        yield* pi.answer(
          yield* pi.next("get_state"),
          rawState({ isStreaming: activeAt === "preflight" }),
        );
        if (activeAt === "post-read") {
          // Pi can start after preflight, before agent_start reaches Piano: no output
          // watermark moves here. Only the retained post-read state check prevents publication.
          yield* pi.answer(yield* pi.next("get_messages"), { messages: [] });
          yield* pi.answer(yield* pi.next("get_state"), rawState({ isStreaming: true }));
        }
        while (!pi.readbacks.idle()) yield* Effect.yieldNow;
        assert.equal(yield* pi.pending, 0, "activity does not spend three snapshot attempts");
        assert.equal(yield* pi.contextLanded, false);
        assert.equal((yield* pi.state).projectionError, undefined);

        // No explicit context request: the pending intent must survive until this boundary.
        yield* pi.readbacks.schedule("stats");
        for (let i = 0; i < 4; i++) {
          const read = yield* pi.nextRead;
          switch (read.type) {
            case "get_state":
              yield* pi.answer(read, rawState({}));
              break;
            case "get_messages":
              yield* pi.answer(read, { messages: [] });
              break;
            case "get_session_stats":
              yield* pi.answer(read, { cost: 1 });
              break;
            default:
              assert.fail(`Unexpected read: ${read.type}`);
          }
        }
        while (!pi.readbacks.idle()) yield* Effect.yieldNow;
        assert.equal(yield* pi.pending, 0);
        assert.equal(yield* pi.contextLanded, true);
        assert.equal((yield* pi.state).projectionError, undefined);
      }),
    );
  });
}

test("requests made while a readback runs coalesce into one more run", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness();
      yield* pi.readbacks.schedule("context");
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      const first = yield* pi.next("get_messages");
      assert.equal(pi.readbacks.idle(), false);
      yield* pi.readbacks.schedule("context");
      yield* pi.readbacks.schedule("context", "context");
      // Let any worker those requests could have started reach Pi.
      yield* Effect.yieldNow;
      assert.equal(yield* pi.pending, 0, "one worker per kind: no concurrent read");
      yield* pi.answer(first, { messages: [] });
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* pi.answer(yield* pi.next("get_messages"), { messages: [] });
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      while (!pi.readbacks.idle()) yield* Effect.yieldNow;
      assert.equal(yield* pi.pending, 0, "three requests during one read cost one more read");
    }),
  );
});
