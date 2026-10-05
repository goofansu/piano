/** Nonblocking delivery. Overflow fails the consumer instead of dropping facts or
 * backpressuring the producer. Limits count serialized bytes, not just frames. */
import { Data, Deferred, Effect, Queue, Stream } from "effect";

export class DeliveryOverflow extends Data.TaggedError("DeliveryOverflow")<{ readonly detail: string; readonly oversized: boolean }> {}

export const makeDelivery = <A>(limits = { messages: 256, bytes: 8 * 1024 * 1024 }) => Effect.gen(function* () {
  const queue = yield* Queue.dropping<{ value: A; bytes: number }>(limits.messages);
  const failed = yield* Deferred.make<never, DeliveryOverflow>();
  let bytes = 0, stopped = false;
  return {
    /** Also race a consumer's blocked external write/ack, not only its next pull. */
    failure: Deferred.await(failed),
    offer: (value: A) => Effect.sync(() => {
      if (stopped) return;
      const size = Buffer.byteLength(JSON.stringify(value));
      if (size + bytes > limits.bytes || !Queue.offerUnsafe(queue, { value, bytes: size })) {
        stopped = true;
        return size > limits.bytes;
      }
      bytes += size;
    }).pipe(Effect.flatMap(oversized => oversized !== undefined
      ? Deferred.fail(failed, new DeliveryOverflow({ oversized, detail: oversized
        ? "Session view exceeds the delivery byte limit. Reduce the context before reconnecting."
        : "Delivery limit exceeded; reconnect for a current snapshot. Some live notices may have been missed." })).pipe(Effect.asVoid)
      : Effect.void)),
    // fromQueue drains a whole chunk; one-at-a-time pulls keep only one frame
    // outside the accounted queue when the consumer waits for socket credit.
    stream: Stream.fromEffectRepeat(Queue.take(queue)).pipe(
      Stream.map(item => { bytes -= item.bytes; return item.value; }),
      Stream.interruptWhen(Deferred.await(failed)),
    ),
  };
});
