import { Deferred, Effect } from "effect";
import { DeliveryOverflow, socketLimits } from "../../../server/shared/BoundedDelivery.ts";
import { inboundLimits } from "../../../server/shared/InboundCapacity.ts";
import type { ServerMessage } from "../../../shared/wire.ts";

type Reply = Extract<ServerMessage, { _tag: "action_result" | "error" }>;
type Entry = {
  reply: Deferred.Deferred<Reply>;
  bytes: number;
  expiry?: ReturnType<typeof setTimeout>;
};

const retentionMs = 24 * 60 * 60 * 1000;
const missing = (queueRequestId: string): Reply => ({
  _tag: "error",
  queueRequestId,
  message: "Could not recover the queue result. Check the session and queue before trying again.",
});

export const makeQueueReceipts = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const entries = new Map<string, Entry>();
  const expire = (id: string, entry: Entry) => {
    entry.expiry = setTimeout(() => entries.delete(id), retentionMs).unref();
  };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const entry of entries.values()) clearTimeout(entry.expiry);
      entries.clear();
    }),
  );
  const room = () => {
    const charged = Array.from(entries.values()).reduce((bytes, entry) => bytes + entry.bytes, 0);
    return (
      entries.size < socketLimits.queue.messages &&
      charged + inboundLimits.rpcLineBytes <= inboundLimits.requests.bytes
    );
  };

  return {
    run: Effect.fn("QueueReceipts.run")(function* (id: string, work: Effect.Effect<Reply>) {
      const old = entries.get(id);
      if (old) return yield* Effect.interruptible(Deferred.await(old.reply));
      if (!room())
        return {
          _tag: "error" as const,
          queueRequestId: id,
          message: "Too many queue results are awaiting delivery. The queue was left alone.",
        };
      const entry: Entry = {
        reply: Deferred.makeUnsafe<Reply>(),
        bytes: inboundLimits.rpcLineBytes,
      };
      entries.set(id, entry);
      yield* work.pipe(
        Effect.catchCause(() => Effect.succeed(missing(id))),
        Effect.tap((reply) =>
          Effect.sync(() => {
            entry.bytes = Buffer.byteLength(JSON.stringify(reply));
            expire(id, entry);
            Deferred.doneUnsafe(entry.reply, Effect.succeed(reply));
          }),
        ),
        Effect.forkIn(scope, { uninterruptible: false }),
      );
      return yield* Effect.interruptible(Deferred.await(entry.reply));
    }, Effect.uninterruptible),
    read: Effect.fn("QueueReceipts.read")(function* (id: string) {
      const entry = entries.get(id);
      if (entry) return yield* Deferred.await(entry.reply);
      const reply = missing(id);
      if (entries.size >= socketLimits.queue.messages)
        return yield* new DeliveryOverflow({
          oversized: false,
          detail: "Queue recovery is at capacity. Reconnect to check again.",
        });
      // A reconnect may reach the server before the old socket's action.
      const cancelled = Deferred.makeUnsafe<Reply>();
      Deferred.doneUnsafe(cancelled, Effect.succeed(reply));
      const refused = { reply: cancelled, bytes: 0 };
      entries.set(id, refused);
      expire(id, refused);
      return reply;
    }),
    ack: (id: string) =>
      Effect.sync(() => {
        const entry = entries.get(id);
        if (entry?.expiry && entry.bytes > 0) {
          clearTimeout(entry.expiry);
          entries.delete(id);
        }
      }),
  };
});
