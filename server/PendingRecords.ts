/** The bounded queue between Pi's stdout reader and the session that takes its records. It owns
 * admission against a record count and a byte budget: before anything takes, a full queue refuses
 * (nothing would ever make room); once taking has started, an offer waits for room instead, so
 * the reader stops and Pi waits on its full pipe. An item larger than the whole byte budget could
 * never fit, so it fails rather than waits. Ending keeps accepted items for the taker and wakes
 * any waiting offer. */
import { Cause, Data, Deferred, Effect, Queue, Stream } from "effect";

/** Refused admission. `limit` names the budget the item would exceed. */
export class PendingRecordsFull extends Data.TaggedError("PendingRecordsFull")<{
  readonly limit: "messages" | "bytes";
}> {}

export interface PendingRecords<A> {
  /** Admit `item`, costing `bytes` of the byte budget. Succeeds with false, admitting nothing,
   * once ended (including while it waited). */
  readonly offer: (item: A, bytes: number) => Effect.Effect<boolean, PendingRecordsFull>;
  /** Every admitted item in order; pulling marks taking started and frees an item's budget as it
   * is taken. Ends after `end` once accepted items are taken. */
  readonly items: Stream.Stream<A>;
  /** Stop admitting. Accepted items stay takeable; a waiting offer returns false. */
  readonly end: Effect.Effect<void>;
}

/** Fiber-safe on one JavaScript thread: admission checks and counters change without yielding. */
export const makePendingRecords = <A>(limits: {
  readonly messages: number;
  readonly bytes: number;
}): Effect.Effect<PendingRecords<A>> =>
  Effect.map(Queue.unbounded<{ item: A; bytes: number }, Cause.Done>(), (queue) => {
    // Hand-rolled rather than a bounded Queue with a byte Semaphore: ending must wake a waiting
    // offer at once, while a suspended Queue offer outlives `Queue.end` until the queue drains.
    let messages = 0;
    let bytesHeld = 0;
    let taking = false;
    let ended = false;
    // Every offer waiting for room awaits the same signal; any take or `end` completes it.
    let room: Deferred.Deferred<void> | undefined;
    const wake = () => {
      const waiting = room;
      room = undefined;
      if (waiting) Deferred.doneUnsafe(waiting, Effect.void);
    };
    const exceeded = (bytes: number) =>
      messages >= limits.messages
        ? ("messages" as const)
        : bytesHeld + bytes > limits.bytes
          ? ("bytes" as const)
          : undefined;

    const offer = Effect.fnUntraced(function* (
      item: A,
      bytes: number,
    ): Effect.fn.Return<boolean, PendingRecordsFull> {
      // Even an empty queue could never admit it, so waiting would never end.
      if (bytes > limits.bytes) return yield* new PendingRecordsFull({ limit: "bytes" });
      for (let limit = exceeded(bytes); limit; limit = exceeded(bytes)) {
        if (ended) return false;
        // Nothing takes yet, so nothing would make room.
        if (!taking) return yield* new PendingRecordsFull({ limit });
        room ??= Deferred.makeUnsafe<void>();
        yield* Deferred.await(room);
      }
      if (ended) return false;
      messages += 1;
      bytesHeld += bytes;
      Queue.offerUnsafe(queue, { item, bytes });
      return true;
    });

    const items = Stream.fromEffectRepeat(
      Effect.suspend(() => {
        taking = true;
        return Queue.take(queue);
      }),
    ).pipe(
      Stream.map(({ item, bytes }) => {
        messages -= 1;
        bytesHeld -= bytes;
        wake();
        return item;
      }),
    );

    const end = Effect.suspend(() => {
      ended = true;
      wake();
      // Queue.end preserves accepted items for the taker.
      return Queue.end(queue);
    }).pipe(Effect.asVoid);

    return { offer, items, end };
  });
