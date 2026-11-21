import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Effect } from "effect";
import {
  Registry,
  type RegistryData,
  RegistryDatabasePath,
  RegistryLive,
} from "../../server/shared/registry/Registry.ts";
import { openRegistryDatabase } from "../../server/shared/registry/RegistryDatabase.ts";

type Seed = Partial<Omit<RegistryData, "sessions">> & {
  sessions?: ReadonlyArray<
    Omit<RegistryData["sessions"][number], "archived"> & { archived?: boolean }
  >;
};

export function seedRegistry(database: string, seed: Seed) {
  const data: RegistryData = {
    version: 2,
    projects: seed.projects ?? [],
    folders: seed.folders ?? [],
    worktrees: seed.worktrees ?? [],
    workspaces: [...(seed.workspaces ?? [])],
    sessions: (seed.sessions ?? []).map((s) => ({ ...s, archived: s.archived ?? false })),
  };
  const workspaces = data.workspaces as RegistryData["workspaces"][number][];
  for (const path of [
    ...data.folders,
    ...data.worktrees.map((w) => w.path),
    ...data.sessions.map((s) => s.cwd),
  ]) {
    if (!workspaces.some((w) => w.path === path))
      workspaces.push({
        id: randomUUID(),
        path,
        folder: data.worktrees.find((w) => w.path === path)?.folder ?? path,
      });
  }
  openRegistryDatabase(database, data).close();
}

export function registryEnv(config: string) {
  readRegistry(config);
  return { PIANO_DB_PATH: `${config}.sqlite` };
}

export function readRegistry(config: string, database = `${config}.sqlite`) {
  if (!existsSync(database))
    seedRegistry(database, existsSync(config) ? JSON.parse(readFileSync(config, "utf8")) : {});
  return Effect.runSync(
    Effect.gen(function* () {
      return yield* (yield* Registry).get;
    }).pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryDatabasePath, database)),
  );
}
