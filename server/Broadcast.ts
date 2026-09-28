/** Server messages every connected client should receive (sidebar changes). */
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import type { ServerMessage } from "../shared/wire.ts";

export class Broadcast extends Context.Service<
  Broadcast,
  {
    readonly publish: (message: ServerMessage) => Effect.Effect<void>;
    readonly stream: Stream.Stream<ServerMessage>;
  }
>()("piano/Broadcast") {}

export const BroadcastLive = Layer.effect(
  Broadcast,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<ServerMessage>();
    return Broadcast.of({
      publish: (message) => PubSub.publish(pubsub, message).pipe(Effect.asVoid),
      stream: Stream.fromPubSub(pubsub),
    });
  }),
);
