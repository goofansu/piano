/**
 * Piano config: the list of selected projects.
 * Stored at ~/.config/piano/config.json (override with PIANO_CONFIG).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface PianoConfig {
  projects: string[];
}

export const CONFIG_PATH =
  process.env.PIANO_CONFIG ?? join(homedir(), ".config", "piano", "config.json");

export function readConfig(): PianoConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { projects: [] };
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<PianoConfig>;
    const projects = Array.isArray(raw.projects)
      ? raw.projects.filter((p): p is string => typeof p === "string")
      : [];
    return { projects };
  } catch {
    return { projects: [] };
  }
}

export function writeConfig(config: PianoConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}
