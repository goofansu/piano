/**
 * Skills the user creates in Piano, kept in Piano's own skills folder beside its database
 * (`<name>/SKILL.md`); every Pi child Piano starts loads that folder with `--skill` (main.ts), so
 * they are Piano's only, as prompts are. Pi owns loading (INV-12). What a save or delete does is
 * `Library.ts`'s decision; this module is the skill layout: how a skill is listed, written and
 * removed as a directory holding its SKILL.md. Skills
 * anywhere else (`~/.agents/skills`, Pi's own folder, its settings and packages, a repository's)
 * are never listed or touched, only read to tell whether Pi loads a name from them first
 * (`PiLoads.ts`).
 * Nothing here changes a running session: one started from now loads the new set, and a running
 * one on `/reload`.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";
import { skillFile as fileOf } from "../shared/library.ts";
import type {
  UserSkill,
  UserSkillCreate,
  UserSkillProposal,
  UserSkillUpdate,
} from "../shared/skills.ts";
import { type LibraryError, makeLibrary, type Shelved } from "./Library.ts";
import { pianoFolder } from "./PianoFolders.ts";
import { agentDir } from "./PiEnv.ts";

export const UserSkillsEnvironment = Context.Reference<{
  /** Piano's skills folder, where it writes skills and which every Pi child loads. */
  directory: () => string;
  /** Pi's agent folder, whose settings, packages and skills Pi loads before Piano's folder; read
   * only to refuse a name Pi already loads. */
  agentDir: () => string;
}>("piano/UserSkillsEnvironment", {
  defaultValue: () => ({ directory: () => pianoFolder("skills"), agentDir }),
});

export class UserSkills extends Context.Service<
  UserSkills,
  {
    /** The skills Pi loads from Piano's folder, by the name Pi loads each as. */
    readonly list: Effect.Effect<ReadonlyArray<UserSkill>>;
    /** What saving `request` would do, refused as the save would refuse it; writes nothing. A
     * skill Piano created is updated, keeping its Disable model invocation unless the draft sets
     * it; any other name is created. Either is refused when Pi loads a skill of that name from
     * another folder first. */
    readonly propose: (request: UserSkillCreate) => Effect.Effect<UserSkillProposal, LibraryError>;
    readonly create: (request: UserSkillCreate) => Effect.Effect<UserSkill, LibraryError>;
    /** Replaces the SKILL.md of a skill Piano created; any other name is refused, so a skill in
     * another folder Pi loads, or a repository's, is never written over, and so is one Pi loads
     * from another folder first, since the change would never reach a session. With `previous`, only
     * that file is replaced: a skill changed since it was shown is refused, and nothing written. */
    readonly update: (request: UserSkillUpdate) => Effect.Effect<UserSkill, LibraryError>;
    /** Removes a skill Piano created, with its directory, even one Pi loads from another folder
     * first; any other skill is refused. */
    readonly remove: (name: string) => Effect.Effect<void, LibraryError>;
  }
>()("piano/UserSkills") {}

/** A real directory or file at `path`, not a link. */
const isReal = (path: string, kind: "directory" | "file") => {
  try {
    const stat = lstatSync(path);
    return kind === "directory" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
};

/**
 * The skills Pi loads from Piano's folder, by the name Pi gives each (INV-12: Pi's own loader, not
 * a copy of its rules), in Piano's layout: `<folder>/<directory>/SKILL.md`, both real, not links,
 * so nothing here reaches outside the folder. A SKILL.md whose declared name differs from its
 * directory's is listed under the name Pi loads it as. Of two that declare one name, only the one
 * Pi loads counts, even when that one is outside Piano's layout and so not listed.
 */
function pianoSkills(root: string): Map<string, Shelved<UserSkill>> {
  const found = new Map<string, Shelved<UserSkill>>();
  const taken = new Set<string>();
  for (const loaded of loadSkillsFromDir({ dir: root, source: "user" }).skills) {
    const dir = loaded.baseDir;
    const file = join(dir, "SKILL.md");
    // Pi keeps the first skill of a name and drops later ones, whatever their layout.
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
    } catch {
      // Unreadable since Pi read it: not listed.
    }
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
      // A name Pi loads from Piano's folder in any layout, or a directory of that name.
      occupied: (name) =>
        loadSkillsFromDir({ dir: root(), source: "user" }).skills.some((s) => s.name === name) ||
        existsSync(join(root(), name)),
      // A save over a skill keeps its Disable model invocation unless the draft sets it.
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
        // Only the skill's own directory existing means the name is taken; any other failure is
        // a failed save.
        const failed = (cause: unknown) => new Error("Could not save the skill.", { cause });
        try {
          mkdirSync(root(), { recursive: true });
        } catch (cause) {
          throw failed(cause);
        }
        // Not recursive: an existing directory of that name, Piano's or not, refuses the create.
        mkdirSync(dir);
        try {
          writeFileSync(join(dir, "SKILL.md"), skill.file, { flag: "wx" });
        } catch (cause) {
          rmSync(dir, { recursive: true, force: true });
          throw failed(cause);
        }
      },
      // The skill's whole directory.
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
