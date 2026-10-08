/** Read persisted scratch state through Registry, not the retired JSON representation. */
import { Effect } from "effect";
import { Registry, RegistryDatabasePath, RegistryLive, RegistryPath } from "../../server/Registry.ts";

/** Seed scratch SQLite explicitly through Registry before starting a browser-test backend. */
export function registryEnv(config: string) {
  readRegistry(config);
  return { PIANO_DB_PATH: `${config}.sqlite` };
}

export const readRegistry = (config: string, database = `${config}.sqlite`) => Effect.runSync(Effect.gen(function* () {
  return yield* (yield* Registry).get;
}).pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryPath, config), Effect.provideService(RegistryDatabasePath, database)));
