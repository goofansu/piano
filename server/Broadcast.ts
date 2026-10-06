/** Server messages every connected client should receive (sidebar changes). */
import { Context, Effect, Layer, PubSub, type Scope, Stream } from "effect";
import type { ServerMessage } from "../shared/wire.ts";
type Projects = Extract<ServerMessage, { _tag: "projects" }>;

export class Broadcast extends Context.Service<
  Broadcast,
  {
    readonly publish: (message: Projects) => Effect.Effect<void>;
    /** The last published projects, so a new connection can show them before discovery finishes. */
    readonly latest: Effect.Effect<Projects | undefined>;
    /** Subscribes now, so nothing published after this returns is missed. */
    readonly subscribe: Effect.Effect<Stream.Stream<Projects>, never, Scope.Scope>;
  }
>()("piano/Broadcast") {}

export const BroadcastLive = Layer.effect(
  Broadcast,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<Projects>(1);
    let latest: Projects | undefined;
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
