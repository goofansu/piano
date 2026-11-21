import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";
import { skillFile as fileOf } from "../../../shared/features/library/library.ts";
import type {
  UserSkill,
  UserSkillCreate,
  UserSkillProposal,
  UserSkillUpdate,
} from "../../../shared/features/library/skills.ts";
import { agentDir } from "../../shared/PiEnv.ts";
import { type LibraryError, makeLibrary, type Shelved } from "./Library.ts";
import { pianoFolder } from "./PianoFolders.ts";

export const UserSkillsEnvironment = Context.Reference<{
  directory: () => string;
  agentDir: () => string;
}>("piano/UserSkillsEnvironment", {
  defaultValue: () => ({ directory: () => pianoFolder("skills"), agentDir }),
});

export class UserSkills extends Context.Service<
  UserSkills,
  {
    readonly list: Effect.Effect<ReadonlyArray<UserSkill>>;
    readonly propose: (request: UserSkillCreate) => Effect.Effect<UserSkillProposal, LibraryError>;
    readonly create: (request: UserSkillCreate) => Effect.Effect<UserSkill, LibraryError>;
    readonly update: (request: UserSkillUpdate) => Effect.Effect<UserSkill, LibraryError>;
    readonly remove: (name: string) => Effect.Effect<void, LibraryError>;
  }
>()("piano/UserSkills") {}

const isReal = (path: string, kind: "directory" | "file") => {
  try {
    const stat = lstatSync(path);
    return kind === "directory" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
};

function pianoSkills(root: string): Map<string, Shelved<UserSkill>> {
  const found = new Map<string, Shelved<UserSkill>>();
  const taken = new Set<string>();
  for (const loaded of loadSkillsFromDir({ dir: root, source: "user" }).skills) {
    const dir = loaded.baseDir;
    const file = join(dir, "SKILL.md");
    if (taken.has(loaded.name)) continue;
    taken.add(loaded.name);
    if (dirname(dir) !== root || loaded.filePath !== file) continue;
    if (!isReal(dir, "directory") || !isReal(file, "file")) continue;
    try {
      found.set(loaded.name, {
        path: file,
        entry: {
          name: loaded.name,
          description: loaded.description,
          file: readFileSync(file, "utf8"),
          disableModelInvocation: loaded.disableModelInvocation,
        },
      });
    } catch {}
  }
  return found;
}

export const UserSkillsLive = Layer.effect(
  UserSkills,
  Effect.gen(function* () {
    const environment = yield* UserSkillsEnvironment;
    const root = environment.directory;

    const library = makeLibrary<UserSkill, UserSkillCreate>({
      kind: "skill",
      folder: root,
      agentDir: environment.agentDir,
      shelf: async () => pianoSkills(root()),
      find: async (name) => pianoSkills(root()).get(name),
      occupied: (name) =>
        loadSkillsFromDir({ dir: root(), source: "user" }).skills.some((s) => s.name === name) ||
        existsSync(join(root(), name)),
      render: (saved, request, kept) => {
        const disableModelInvocation =
          request.disableModelInvocation ?? kept?.disableModelInvocation ?? false;
        return {
          name: saved.name,
          description: saved.description,
          file: fileOf({ ...saved, disableModelInvocation }),
          disableModelInvocation,
        };
      },
      create: async (skill) => {
        const dir = join(root(), skill.name);
        const failed = (cause: unknown) => new Error("Could not save the skill.", { cause });
        try {
          mkdirSync(root(), { recursive: true });
        } catch (cause) {
          throw failed(cause);
        }
        mkdirSync(dir);
        try {
          writeFileSync(join(dir, "SKILL.md"), skill.file, { flag: "wx" });
        } catch (cause) {
          rmSync(dir, { recursive: true, force: true });
          throw failed(cause);
        }
      },
      remove: async ({ path }) => rmSync(dirname(path), { recursive: true }),
    });

    return UserSkills.of({
      list: library.list,
      propose: (request) =>
        library.propose(request).pipe(
          Effect.map(({ change, entry, previous }) => ({
            change,
            name: entry.name,
            file: entry.file,
            ...(previous !== undefined ? { previous } : {}),
            disableModelInvocation: entry.disableModelInvocation,
          })),
        ),
      create: library.create,
      update: library.update,
      remove: library.remove,
    });
  }),
);
