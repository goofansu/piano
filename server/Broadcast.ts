/** Server messages every connected client should receive (sidebar changes). */
import { Context, Effect, Layer, PubSub, type Scope, Stream } from "effect";
import type { ServerMessage } from "../shared/wire.ts";

type RegistryMessage = Extract<ServerMessage, { _tag: "registry" }>;

export class Broadcast extends Context.Service<
  Broadcast,
  {
    readonly publish: (message: RegistryMessage) => Effect.Effect<void>;
    /** The last published registry view, so a new connection can show them before discovery finishes. */
    readonly latest: Effect.Effect<RegistryMessage | undefined>;
    /** Subscribes now, so nothing published after this returns is missed. */
    readonly subscribe: Effect.Effect<Stream.Stream<RegistryMessage>, never, Scope.Scope>;
  }
>()("piano/Broadcast") {}

export const BroadcastLive = Layer.effect(
  Broadcast,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<RegistryMessage>(1);
    let latest: RegistryMessage | undefined;
    return Broadcast.of({
      publish: (message) => Effect.suspend(() => {
        latest = message;
        return PubSub.publish(pubsub, message);
      }).pipe(Effect.asVoid),
      latest: Effect.sync(() => latest),
      subscribe: PubSub.subscribe(pubsub).pipe(Effect.map(Stream.fromSubscription)),
    });
  }),
);
