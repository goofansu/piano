/** Nonblocking delivery. Overflow fails the consumer instead of dropping facts or
 * backpressuring the producer. Limits count serialized bytes, not just frames. */
import { Data, Deferred, type Duration, Effect, Queue, Stream } from "effect";

export class DeliveryOverflow extends Data.TaggedError("DeliveryOverflow")<{
  readonly detail: string;
  readonly oversized: boolean;
}> {}

export const makeDelivery = Effect.fnUntraced(function* <A>(
  limits = { messages: 256, bytes: 8 * 1024 * 1024 },
) {
  const queue = yield* Queue.dropping<{ value: A; bytes: number }>(limits.messages);
  const failed = yield* Deferred.make<never, DeliveryOverflow>();
  let bytes = 0,
    stopped = false;
  return {
    /** Also race a consumer's blocked external write/ack, not only its next pull. */
    failure: Deferred.await(failed),
    offer: (value: A) =>
      Effect.sync(() => {
        if (stopped) return;
        const size = Buffer.byteLength(JSON.stringify(value));
        if (size + bytes > limits.bytes || !Queue.offerUnsafe(queue, { value, bytes: size })) {
          stopped = true;
          return size > limits.bytes;
        }
        bytes += size;
      }).pipe(
        Effect.flatMap((oversized) =>
          oversized !== undefined
            ? Deferred.fail(
                failed,
                new DeliveryOverflow({
                  oversized,
                  detail: oversized
                    ? "Session view exceeds the delivery byte limit. Reduce the context before reconnecting."
                    : "Delivery limit exceeded; reconnect for a current snapshot. Some live notices may have been missed.",
                }),
              ).pipe(Effect.asVoid)
            : Effect.void,
        ),
      ),
    // fromQueue drains a whole chunk; one-at-a-time pulls keep only one frame
    // outside the accounted queue when the consumer waits for socket credit.
    stream: Stream.fromEffectRepeat(Queue.take(queue)).pipe(
      Stream.map((item) => {
        bytes -= item.bytes;
        return item.value;
      }),
      Stream.interruptWhen(Deferred.await(failed)),
    ),
  };
});

export interface SocketClose {
  readonly reason: string;
  readonly code: number;
}

/** Socket close codes: 1009 a single frame or view is too large to ever deliver;
 * 1013 the client fell behind and should reconnect for a current snapshot. */
export const CloseCode = { tooLarge: 1009, tryAgainLater: 1013 } as const;

export const socketLimits = {
  /** Retained frames waiting for the socket window. */
  queue: { messages: 256, bytes: 8 * 1024 * 1024 },
  /** Written but unacknowledged frames. */
  window: { frames: 32, bytes: 8 * 1024 * 1024 },
  /** Largest single encoded frame. */
  frameBytes: 8 * 1024 * 1024,
  /** Deadline for each written frame's acknowledgement. */
  ackTimeout: "10 seconds" as Duration.Input,
};

/**
 * Socket delivery: the bounded queue plus a credit window of written, unacknowledged
 * frames. ws.send itself has no backpressure, so frames carry increasing delivery IDs
 * and the browser acknowledges cumulatively, avoiding stop-and-wait RTT per token.
 * Holds at most queue limits + one staging frame waiting for credit + the window.
 * Every limit breach or missing acknowledgement resolves `closed` exactly once with
 * the reason and close code; the caller closes the socket. Requires a Scope that
 * outlives delivery; the writer fiber and acknowledgement deadlines live in it.
 */
export const makeSocketDelivery = Effect.fnUntraced(function* <A, E>(
  write: (text: string) => Effect.Effect<void, E>,
  encode: (value: A, deliveryId: number) => string,
  limits = socketLimits,
) {
  const closedWith = yield* Deferred.make<SocketClose>();
  const close = (reason: string, code: number = CloseCode.tryAgainLater) =>
    Deferred.succeed(closedWith, { reason, code }).pipe(Effect.asVoid);
  const outbox = yield* makeDelivery<A>(limits.queue);
  let deliveryId = 0;
  const pending = new Map<number, { bytes: number; done: Deferred.Deferred<void> }>();
  let pendingBytes = 0;
  let credit = yield* Deferred.make<void>();
  yield* outbox.stream.pipe(
    Stream.runForEach((value) =>
      Effect.gen(function* () {
        const text = encode(value, ++deliveryId);
        const bytes = Buffer.byteLength(text);
        if (bytes > limits.frameBytes)
          return yield* close(
            `Session view exceeds the ${limits.frameBytes / (1024 * 1024)} MiB delivery limit. Reduce the context before reconnecting.`,
            CloseCode.tooLarge,
          );
        while (pending.size >= limits.window.frames || pendingBytes + bytes > limits.window.bytes)
          yield* Deferred.await(credit);
        const done = yield* Deferred.make<void>();
        pending.set(deliveryId, { bytes, done });
        pendingBytes += bytes;
        yield* Effect.orDie(write(text)); // a failed write ends delivery below, like any defect
        // A tail shorter than the window also has a deadline; never retain it forever.
        yield* Deferred.await(done).pipe(
          Effect.timeout(limits.ackTimeout),
          Effect.catchCause(() =>
            close("Delivery acknowledgement timed out; reconnect for a current snapshot."),
          ),
          Effect.forkScoped,
        );
      }),
    ),
    Effect.raceFirst(outbox.failure),
    Effect.catchTag("DeliveryOverflow", (error) =>
      close(error.detail, error.oversized ? CloseCode.tooLarge : CloseCode.tryAgainLater),
    ),
    Effect.catchCause(() => close("Delivery interrupted; reconnect for a current snapshot.")),
    Effect.forkScoped,
  );
  return {
    /** Never blocks the producer; overflow closes delivery instead. */
    offer: outbox.offer,
    /** Cumulative: acknowledges every pending frame up to `id`. Unknown or stale IDs are ignored. */
    ack: Effect.fnUntraced(function* (id: number) {
      if (!pending.has(id)) return;
      for (const [pendingId, item] of pending)
        if (pendingId <= id) {
          pending.delete(pendingId);
          pendingBytes -= item.bytes;
          yield* Deferred.succeed(item.done, undefined);
        }
      const available = credit;
      credit = yield* Deferred.make<void>();
      yield* Deferred.succeed(available, undefined);
    }),
    /** Ends delivery with a close reason; the first reason wins. */
    close,
    /** Resolves with the first reason delivery ended. */
    closed: Deferred.await(closedWith),
  };
});
