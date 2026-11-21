import { Cause, Data, Deferred, Effect, Queue, Stream } from "effect";

export class PendingRecordsFull extends Data.TaggedError("PendingRecordsFull")<{
  readonly limit: "messages" | "bytes";
}> {}

export interface PendingRecords<A> {
  readonly offer: (item: A, bytes: number) => Effect.Effect<boolean, PendingRecordsFull>;
  readonly items: Stream.Stream<A>;
  readonly end: Effect.Effect<void>;
}

export const makePendingRecords = <A>(limits: {
  readonly messages: number;
  readonly bytes: number;
}): Effect.Effect<PendingRecords<A>> =>
  Effect.map(Queue.unbounded<{ item: A; bytes: number }, Cause.Done>(), (queue) => {
    let messages = 0;
    let bytesHeld = 0;
    let taking = false;
    let ended = false;
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
      if (bytes > limits.bytes) return yield* new PendingRecordsFull({ limit: "bytes" });
      for (let limit = exceeded(bytes); limit; limit = exceeded(bytes)) {
        if (ended) return false;
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
      return Queue.end(queue);
    }).pipe(Effect.asVoid);

    return { offer, items, end };
  });
