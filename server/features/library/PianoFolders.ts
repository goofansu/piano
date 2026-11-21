import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { RegistryDatabasePath } from "../../shared/registry/Registry.ts";

export const pianoFolder = (name: "prompts" | "skills", databasePath?: string) =>
  join(dirname(databasePath ?? RegistryDatabasePath.defaultValue()), name);

// Pi reports a missing --skill directory as a conflict; create it before startup.
export const ensurePianoFolders = () => {
  for (const name of ["prompts", "skills"] as const)
    mkdirSync(pianoFolder(name), { recursive: true });
};
