/** Read persisted scratch state through Registry, not the retired JSON representation. */
import { Effect } from "effect";
import { Registry, RegistryDatabasePath, RegistryLive, RegistryPath } from "../../server/Registry.ts";

export const readRegistry = (config: string) => Effect.runSync(Effect.gen(function* () {
  return yield* (yield* Registry).get;
}).pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryPath, config), Effect.provideService(RegistryDatabasePath, `${config}.sqlite`)));
