/**
 * Piano's own folders beside its database: what the person creates in Piano and only Piano's Pi
 * children load. A scratch database (`PIANO_DB_PATH`) brings its own folders with it.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { RegistryDatabasePath } from "./Registry.ts";

export const pianoFolder = (name: "prompts" | "skills", databasePath?: string) =>
  join(dirname(databasePath ?? RegistryDatabasePath.defaultValue()), name);

/**
 * Creates both folders, so every Pi child's `--prompt-template` and `--skill` name a folder that
 * exists: Pi reports a missing `--skill` path at startup as a skill conflict.
 */
export const ensurePianoFolders = () => {
  for (const name of ["prompts", "skills"] as const)
    mkdirSync(pianoFolder(name), { recursive: true });
};
