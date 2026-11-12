import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Fiber, Option, Stream } from "effect";
import { makePendingRecords } from "../server/PendingRecords.ts";

const limits = { messages: 3, bytes: 10 };
const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.timeout("5 seconds")));

test("INV-03: before anything takes, a full queue refuses and names the limit it hit", async () => {
  await run(
    Effect.gen(function* () {
      const records = yield* makePendingRecords<string>(limits);
      assert.equal(yield* records.offer("a", 6), true);
      const bytes = yield* records.offer("b", 5).pipe(Effect.flip);
      assert.equal(bytes.limit, "bytes");
      assert.equal(yield* records.offer("b", 1), true);
      assert.equal(yield* records.offer("c", 1), true);
      const messages = yield* records.offer("d", 1).pipe(Effect.flip);
      assert.equal(messages.limit, "messages");
    }),
  );
});

test("INV-03: once taking, an offer over the byte budget waits for a take instead of failing", async () => {
  await run(
    Effect.gen(function* () {
      const records = yield* makePendingRecords<string>(limits);
      // Start taking; the queue then holds "b" (8 of 10 bytes).
      const first = yield* records.items.pipe(Stream.runHead, Effect.forkChild);
      assert.equal(yield* records.offer("a", 8), true);
      assert.equal(Option.getOrThrow(yield* Fiber.join(first)), "a");
      assert.equal(yield* records.offer("b", 8), true);
      const waiting = yield* records.offer("c", 8).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.equal(waiting.pollUnsafe(), undefined, "an offer over the byte budget waits");
      const next = yield* records.items.pipe(Stream.runHead);
      assert.equal(Option.getOrThrow(next), "b");
      assert.equal(yield* Fiber.join(waiting), true);
    }),
  );
});

test("INV-03: ending wakes a waiting offer without admitting it and keeps accepted items", async () => {
  await run(
    Effect.gen(function* () {
      const records = yield* makePendingRecords<string>(limits);
      // Start taking, then leave the queue full while nothing takes.
      const first = yield* records.items.pipe(Stream.runHead, Effect.forkChild);
      assert.equal(yield* records.offer("a", 1), true);
      yield* Fiber.join(first);
      for (const item of ["b", "c", "d"]) assert.equal(yield* records.offer(item, 1), true);
      const waiting = yield* records.offer("e", 1).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.equal(waiting.pollUnsafe(), undefined, "a full queue makes the offer wait");
      yield* records.end;
      assert.equal(yield* Fiber.join(waiting), false);
      assert.equal(yield* records.offer("f", 1), false);
      assert.deepEqual(Array.from(yield* Stream.runCollect(records.items)), ["b", "c", "d"]);
    }),
  );
});

test("INV-03: an item larger than the whole byte budget fails instead of waiting", async () => {
  await run(
    Effect.gen(function* () {
      const records = yield* makePendingRecords<string>(limits);
      const first = yield* records.items.pipe(Stream.runHead, Effect.forkChild);
      assert.equal(yield* records.offer("a", 1), true);
      yield* Fiber.join(first);
      const error = yield* records.offer("huge", limits.bytes + 1).pipe(Effect.flip);
      assert.equal(error.limit, "bytes");
      assert.equal(yield* records.offer("exact", limits.bytes), true);
    }),
  );
});
