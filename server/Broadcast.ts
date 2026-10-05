/** Server messages every connected client should receive (sidebar changes). */
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import type { ServerMessage } from "../shared/wire.ts";
type Projects = Extract<ServerMessage, { _tag: "projects" }>;

export class Broadcast extends Context.Service<
  Broadcast,
  {
    readonly publish: (message: Projects) => Effect.Effect<void>;
    readonly stream: Stream.Stream<Projects>;
  }
>()("piano/Broadcast") {}

export const BroadcastLive = Layer.effect(
  Broadcast,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<Projects>(1);
    return Broadcast.of({
      publish: (message) => PubSub.publish(pubsub, message).pipe(Effect.asVoid),
      stream: Stream.fromPubSub(pubsub),
    });
  }),
);
