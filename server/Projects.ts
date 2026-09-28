/**
 * The list of selected projects, stored at ~/.config/piano/config.json
 * (override with PIANO_CONFIG).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Data, Effect } from "effect";
import { expandHome } from "./PiEnv.ts";

export class ProjectError extends Data.TaggedError("ProjectError")<{ readonly detail: string }> {}

export const CONFIG_PATH = process.env.PIANO_CONFIG ?? join(homedir(), ".config", "piano", "config.json");

const read = (): string[] => {
  try {
    if (!existsSync(CONFIG_PATH)) return [];
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { projects?: unknown };
    return Array.isArray(raw.projects) ? raw.projects.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
};

const write = (projects: string[]): void => {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify({ projects }, null, 2)}\n`);
};

export const listProjects: Effect.Effect<string[]> = Effect.sync(read);

export const addProject = (raw: string): Effect.Effect<string[], ProjectError> =>
  Effect.gen(function* () {
    const path = resolve(expandHome(raw));
    if (!existsSync(path) || !statSync(path).isDirectory()) return yield* new ProjectError({ detail: `Not a directory: ${path}` });
    const projects = read();
    if (!projects.includes(path)) {
      projects.push(path);
      write(projects);
    }
    return projects;
  });

export const removeProject = (path: string): Effect.Effect<string[]> =>
  Effect.sync(() => {
    const projects = read().filter((p) => p !== path);
    write(projects);
    return projects;
  });
