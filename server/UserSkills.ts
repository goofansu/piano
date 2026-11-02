/**
 * Skills the user creates in Piano, kept in Piano's own skills folder beside its database
 * (`<name>/SKILL.md`); every Pi child Piano starts loads that folder with `--skill` (main.ts), so
 * they are Piano's only, as prompts are. Pi owns loading (INV-12); this module writes a new skill's
 * file, replaces the file of one it created, lists the folder and removes a skill from it. Skills elsewhere (`~/.agents/skills`, Pi's own
 * folder, a repository's) are never listed or touched, only read to refuse a name Pi already loads.
 * Nothing here changes a running session: one started from now loads the new set, and a running
 * one on `/reload`.
 */
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSkillsFromDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import { checkDraft, type DraftField, isName } from "../shared/drafts.ts";
import { skillFile as fileOf } from "../shared/library.ts";
import type { UserSkill, UserSkillCreate } from "../shared/skills.ts";
import { pianoFolder } from "./PianoFolders.ts";
import { agentDir } from "./PiEnv.ts";

export const UserSkillsEnvironment = Context.Reference<{
  /** Piano's skills folder, where it writes skills and which every Pi child loads. */
  directory: () => string;
  /** The other folders Pi loads user skills from, read only to refuse a name Pi already loads. */
  others: () => readonly string[];
}>("piano/UserSkillsEnvironment", {
  defaultValue: () => ({
    directory: () => pianoFolder("skills"),
    others: () => [
      join(process.env.HOME || homedir(), ".agents", "skills"),
      join(agentDir(), "skills"),
    ],
  }),
});

/** A refusal written for people; `field` names the editor field it belongs to, if any. */
export class UserSkillError extends Data.TaggedError("UserSkillError")<{
  readonly detail: string;
  readonly field?: DraftField;
}> {}
const refused = (detail: string, field?: DraftField) =>
  new UserSkillError(field ? { detail, field } : { detail });

export class UserSkills extends Context.Service<
  UserSkills,
  {
    /** The skills Piano created, by name. */
    readonly list: Effect.Effect<ReadonlyArray<UserSkill>>;
    readonly create: (request: UserSkillCreate) => Effect.Effect<UserSkill, UserSkillError>;
    /** Replaces the SKILL.md of a skill Piano created; any other name is refused, so a skill in
     * another folder Pi loads, or a repository's, is never written over. */
    readonly update: (request: UserSkillCreate) => Effect.Effect<UserSkill, UserSkillError>;
    /** Removes a skill Piano created, with its directory; any other skill is refused. */
    readonly remove: (name: string) => Effect.Effect<void, UserSkillError>;
  }
>()("piano/UserSkills") {}

const isDirectory = (path: string) => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The skill named `name` in Piano's folder: a real directory (not a link) of that name whose own
 * SKILL.md declares that name, as Pi reads it.
 */
function piano(root: string, name: string): UserSkill | undefined {
  const dir = join(root, name);
  if (!isDirectory(dir)) return undefined;
  const file = join(dir, "SKILL.md");
  try {
    if (!lstatSync(file).isFile()) return undefined;
    const text = readFileSync(file, "utf8");
    const { frontmatter } = parseFrontmatter(text);
    const { description } = frontmatter;
    // Pi's own rule: a name that is not a string (`name: 123` reads as a number) falls back to the
    // directory's, so such a skill is still the one Pi loads as `name`.
    const declared = typeof frontmatter.name === "string" ? frontmatter.name : name;
    if (declared !== name || typeof description !== "string") return undefined;
    return {
      name,
      description,
      file: text,
      disableModelInvocation: frontmatter["disable-model-invocation"] === true,
    };
  } catch {
    return undefined;
  }
}

export const UserSkillsLive = Layer.effect(
  UserSkills,
  Effect.gen(function* () {
    const environment = yield* UserSkillsEnvironment;
    const root = environment.directory;

    const list = Effect.sync(() => {
      let entries: string[];
      try {
        entries = readdirSync(root());
      } catch {
        return [];
      }
      return entries
        .map((entry) => piano(root(), entry))
        .filter((skill): skill is UserSkill => !!skill)
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    /** Names Pi loads from either user directory, so a new skill never loses a name collision. */
    const loaded = () =>
      new Set(
        [root(), ...environment.others()].flatMap((dir) =>
          loadSkillsFromDir({ dir, source: "user" }).skills.map((skill) => skill.name),
        ),
      );

    const create = Effect.fn("UserSkills.create")(function* (request: UserSkillCreate) {
      const check = checkDraft(request);
      if (!check.saved)
        return yield* refused(
          check.problem?.detail ?? "Could not save the skill.",
          check.problem?.field,
        );
      const saved = {
        ...check.saved,
        disableModelInvocation: request.disableModelInvocation === true,
      };
      const { name } = saved;
      const dir = join(root(), name);
      return yield* Effect.try({
        try: () => {
          if (loaded().has(name)) throw refused(`A skill named ${name} already exists.`, "name");
          mkdirSync(root(), { recursive: true });
          try {
            // Not recursive: an existing directory of that name, Piano's or not, refuses the create.
            mkdirSync(dir);
          } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === "EEXIST")
              throw refused(`A skill named ${name} already exists.`, "name");
            throw cause;
          }
          try {
            writeFileSync(join(dir, "SKILL.md"), fileOf(saved), {
              flag: "wx",
            });
          } catch (cause) {
            rmSync(dir, { recursive: true, force: true });
            throw cause;
          }
          return {
            name,
            description: saved.description,
            file: fileOf(saved),
            disableModelInvocation: saved.disableModelInvocation,
          };
        },
        catch: (cause) =>
          cause instanceof UserSkillError ? cause : refused("Could not save the skill."),
      });
    });

    const update = Effect.fn("UserSkills.update")(function* (request: UserSkillCreate) {
      const check = checkDraft(request);
      if (!check.saved)
        return yield* refused(
          check.problem?.detail ?? "Could not save the skill.",
          check.problem?.field,
        );
      const saved = {
        ...check.saved,
        disableModelInvocation: request.disableModelInvocation === true,
      };
      const { name } = saved;
      // The name rule keeps the path inside the skills directory.
      if (!piano(root(), name)) return yield* refused("Skill not found.", "name");
      const text = fileOf(saved);
      const dir = join(root(), name);
      return yield* Effect.try({
        try: () => {
          // Written beside it, then renamed over it: a reader sees the old file or the new one.
          const temporary = join(dir, `.SKILL.md.${process.pid}.${Date.now()}`);
          writeFileSync(temporary, text, { flag: "wx" });
          try {
            renameSync(temporary, join(dir, "SKILL.md"));
          } catch (cause) {
            rmSync(temporary, { force: true });
            throw cause;
          }
          return {
            name,
            description: saved.description,
            file: text,
            disableModelInvocation: saved.disableModelInvocation,
          };
        },
        catch: () => refused("Could not save the skill."),
      });
    });

    const remove = Effect.fn("UserSkills.remove")(function* (name: string) {
      // The name rule keeps the path inside the skills directory.
      if (!isName(name) || !piano(root(), name)) return yield* refused("Skill not found.");
      yield* Effect.try({
        try: () => rmSync(join(root(), name), { recursive: true }),
        catch: () => refused("Could not delete the skill."),
      });
    });

    return UserSkills.of({ list, create, update, remove });
  }),
);
