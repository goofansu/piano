import assert from "node:assert/strict";
import { test } from "node:test";
import { Deferred, Effect, Fiber, Queue, type Scope } from "effect";
import type { PiReadback } from "../server/PiRecords.ts";
import { PiSessionError } from "../server/PiTransport.ts";
import { makeSessionPublication } from "../server/SessionPublication.ts";
import { makeSessionReadbacks } from "../server/SessionReadbacks.ts";
import type { RenderMsg, SessionState } from "../shared/wire.ts";

/** One readback Pi has been asked for, answered when the test resolves its raw reply. */
interface PendingRead {
  readonly type: string;
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
 * real SessionPublication. */
const harness = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const reads = yield* Queue.unbounded<PendingRead>();
  let observation = 0;
  let buffered = 0;
  const publication = yield* makeSessionPublication({
    cwd: "/readbacks",
    sessionId: initial.sessionId,
    generation: "test",
    initial: { state: initial, messages: [], dialogs: [] },
  });
  const readbacks = makeSessionReadbacks({
    scope,
    read: <A>({ command, decode, invalid }: PiReadback<A>) =>
      Effect.gen(function* () {
        const reply = yield* Deferred.make<unknown, PiSessionError>();
        yield* Queue.offer(reads, { type: String(command.type), reply });
        const value = decode(yield* Deferred.await(reply));
        if (value === undefined)
          return yield* new PiSessionError({ reason: "protocol", detail: invalid });
        return value;
      }),
    observationVersion: () => observation,
    processedVersion: () => observation - buffered,
    drain: Effect.void,
    contextReady: () => true,
    context: () => ({ _tag: "context", messages: [contextMessage] }),
    publication,
    entries: [],
  });
  return {
    readbacks,
    state: publication.state,
    /** Whether a context readback has replaced the projected history. */
    contextLanded: Effect.map(publication.snapshot, (snapshot) =>
      snapshot.messages.some((message) => message.id === contextMessage.id),
    ),
    /** A Pi record arrives: state facts change under the lock, and observed output moves. */
    record: (patch: Partial<SessionState>) =>
      publication.patchState(patch).pipe(Effect.tap(() => Effect.sync(() => observation++))),
    /** Pi's output moves without a state change. */
    output: () => {
      observation++;
    },
    buffer: () => {
      observation++;
      buffered++;
    },
    drain: () => {
      buffered = 0;
    },
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
      const pi = yield* harness;
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
      const pi = yield* harness;
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
      const pi = yield* harness;
      const refresh = yield* pi.readbacks.refresh("stats").pipe(Effect.forkChild);
      const stats = yield* pi.next("get_session_stats");
      yield* pi.record({ model: "fake/beta" });
      yield* pi.answer(stats, { cost: 5 });
      const entries = yield* pi.next("get_entries");
      yield* pi.answer(entries, { entries: [] });
      yield* Fiber.join(refresh);
      const state = yield* pi.state;
      assert.equal(state.model, "fake/beta");
      assert.equal(state.cost, undefined, "the old model's figures never land");
      assert.equal(state.statsUpdatedAt, undefined);
      assert.equal(state.subagents, undefined);
      assert.equal(state.contextIsLastKnown, true);
    }),
  );
});

test("a context raced by Pi output is read three times, then becomes a projection error", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness;
      const refresh = yield* pi.readbacks.refresh("context").pipe(Effect.forkChild);
      for (let attempt = 0; attempt < 3; attempt++) {
        yield* pi.answer(yield* pi.next("get_state"), rawState({}));
        const read = yield* pi.next("get_messages");
        pi.output();
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

test("unchanged received output cannot certify a context while records remain unprocessed", async () => {
  await run(
    Effect.gen(function* () {
      const pi = yield* harness;
      pi.buffer();
      const refresh = yield* pi.readbacks.refresh("context").pipe(Effect.forkChild);
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* pi.answer(yield* pi.next("get_messages"), { messages: [] });
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      const retry = yield* pi.next("get_messages");
      assert.equal(
        yield* pi.contextLanded,
        false,
        "the first read did not land over buffered output",
      );
      pi.drain();
      yield* pi.answer(retry, { messages: [] });
      yield* pi.answer(yield* pi.next("get_state"), rawState({}));
      yield* Fiber.join(refresh);
      assert.equal(yield* pi.contextLanded, true);
    }),
  );
});

for (const activeAt of ["preflight", "post-read"]) {
  test(`active ${activeAt} defers without retrying, then a stats boundary recovers pending context`, async () => {
    await run(
      Effect.gen(function* () {
        const pi = yield* harness;
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
        for (let i = 0; i < 5; i++) {
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
            case "get_entries":
              yield* pi.answer(read, { entries: [] });
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
      const pi = yield* harness;
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
