import assert from "node:assert/strict";
import { test } from "node:test";
import { Deferred, Effect, Fiber, Logger, type Scope } from "effect";
import { makeCoalescedReader } from "../server/CoalescedReader.ts";

/** A read the test completes by hand: each run parks on a gate and answers what the test says. */
const controlledRead = () => {
  const runs: Array<{
    readonly superseded: () => boolean;
    readonly gate: Deferred.Deferred<boolean>;
  }> = [];
  return {
    runs,
    read: (superseded: () => boolean) =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<boolean>();
        runs.push({ superseded, gate });
        return yield* Deferred.await(gate);
      }),
    /** The run under way; a test fails here rather than hanging when none is. */
    current: () => {
      const run = runs[runs.length - 1];
      assert.ok(run, "a read is in flight");
      return run;
    },
  };
};

/** Awaits `done` in the background and says whether it has resolved yet. */
const watch = (done: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    let resolved = false;
    const fiber = yield* Deferred.await(done).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          resolved = true;
        }),
      ),
      Effect.forkChild({ startImmediately: true }),
    );
    return {
      settled: Effect.gen(function* () {
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        return resolved;
      }),
      join: Fiber.join(fiber),
    };
  });

const scoped = <A, E>(body: (scope: Scope.Scope) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.scoped(Effect.flatMap(Effect.scope, body)).pipe(Effect.timeout("5 seconds")),
  );

test("a request during a read coalesces every request into exactly one more read", async () => {
  const io = controlledRead();
  await scoped((scope) =>
    Effect.gen(function* () {
      const reader = makeCoalescedReader({ name: "test", scope, read: io.read });
      yield* reader.request();
      yield* Effect.yieldNow;
      assert.equal(io.runs.length, 1, "the first request starts a read");
      for (let i = 0; i < 20; i++) yield* reader.request();
      yield* Effect.yieldNow;
      assert.equal(io.runs.length, 1, "requests during a read start nothing");
      assert.equal(io.current().superseded(), true, "the read in flight knows it is superseded");
      yield* Deferred.succeed(io.current().gate, true);
      yield* Effect.yieldNow;
      assert.equal(io.runs.length, 2, "one more read for all twenty requests");
      assert.equal(io.current().superseded(), false);
      yield* Deferred.succeed(io.current().gate, true);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      assert.equal(io.runs.length, 2, "the reader is idle until the next request");
      yield* reader.request();
      yield* Effect.yieldNow;
      assert.equal(io.runs.length, 3, "a request while idle starts a read at once");
      yield* Deferred.succeed(io.current().gate, true);
    }),
  );
});

test("a waiter resolves only after a read that started after its request installed", async () => {
  const io = controlledRead();
  await scoped((scope) =>
    Effect.gen(function* () {
      const reader = makeCoalescedReader({ name: "test", scope, read: io.read });
      yield* reader.request();
      yield* Effect.yieldNow;
      const first = io.current();
      // Asked for while the first read is under way: that read may predate the facts it wants.
      const done = yield* Deferred.make<void>();
      yield* reader.request(done);
      const waiting = yield* watch(done);
      yield* Deferred.succeed(first.gate, true);
      yield* Effect.yieldNow;
      assert.equal(yield* waiting.settled, false, "the older read does not answer it");
      assert.equal(io.runs.length, 2, "its own read started");
      yield* Deferred.succeed(io.current().gate, true);
      yield* waiting.join;
    }),
  );
});

test("a superseded read leaves its waiters to the next read, which answers them", async () => {
  const io = controlledRead();
  await scoped((scope) =>
    Effect.gen(function* () {
      const reader = makeCoalescedReader({ name: "test", scope, read: io.read });
      const done = yield* Deferred.make<void>();
      yield* reader.request(done);
      const waiting = yield* watch(done);
      yield* Effect.yieldNow;
      const first = io.current();
      yield* reader.request();
      // The read chooses to install nothing because a newer request arrived.
      assert.equal(first.superseded(), true);
      yield* Deferred.succeed(first.gate, false);
      yield* Effect.yieldNow;
      assert.equal(yield* waiting.settled, false, "a discarded result answers nobody");
      assert.equal(io.runs.length, 2);
      yield* Deferred.succeed(io.current().gate, true);
      yield* waiting.join;
    }),
  );
});

test("a failing read is logged under the reader's name and still answers its waiters", async () => {
  const warnings: string[] = [];
  const logger = Logger.make(({ message, logLevel }) => {
    if (logLevel === "Warn") warnings.push(String(message));
  });
  let attempts = 0;
  await scoped((scope) =>
    Effect.gen(function* () {
      const reader = makeCoalescedReader({
        name: "flaky facts",
        scope,
        read: () =>
          Effect.suspend(() => {
            attempts++;
            return attempts === 1 ? Effect.die(new Error("disk gone")) : Effect.succeed(true);
          }),
      });
      const done = yield* Deferred.make<void>();
      yield* reader.request(done);
      yield* Deferred.await(done);
      assert.equal(attempts, 1, "the failure counted as the read; nothing retried on its own");
      assert.ok(
        warnings.some((w) => w.includes("flaky facts failed")),
        `warned under the reader's name: ${JSON.stringify(warnings)}`,
      );
      const again = yield* Deferred.make<void>();
      yield* reader.request(again);
      yield* Deferred.await(again);
      assert.equal(attempts, 2, "a later request reads again");
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
});
