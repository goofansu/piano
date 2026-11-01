/**
 * Skills the user creates in Piano, kept where Pi and other Agent Skills tools find them for every
 * project: `~/.agents/skills/<name>/SKILL.md`. Pi owns loading (INV-12); this module only writes a
 * new skill's file and removes one it wrote. A skill it writes carries `metadata.created-by: piano`
 * in its frontmatter, and only such a skill is listed or deleted, so skills installed by other tools
 * or kept in the user's own repositories in the same directory are never touched. Nothing here
 * changes a running session: one started from now loads the new set, and a running one on `/reload`.
 */
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSkillsFromDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import {
  SKILL_NAME,
  SKILL_NAME_MAX,
  type UserSkill,
  type UserSkillCreate,
  type UserSkillField,
} from "../shared/skills.ts";
import { agentDir } from "./PiEnv.ts";

const MARKER_KEY = "created-by";
const MARKER = "piano";

export const UserSkillsEnvironment = Context.Reference<{
  /** Where Piano writes skills; Pi reads the same directory as `$HOME/.agents/skills`. */
  directory: () => string;
  /** Pi's own user skills directory, read only to refuse a name Pi already loads from there. */
  piDirectory: () => string;
}>("piano/UserSkillsEnvironment", {
  defaultValue: () => ({
    directory: () => join(process.env.HOME || homedir(), ".agents", "skills"),
    piDirectory: () => join(agentDir(), "skills"),
  }),
});

/** A refusal written for people; `field` names the editor field it belongs to, if any. */
export class UserSkillError extends Data.TaggedError("UserSkillError")<{
  readonly detail: string;
  readonly field?: UserSkillField;
}> {}
const refused = (detail: string, field?: UserSkillField) =>
  new UserSkillError(field ? { detail, field } : { detail });

export class UserSkills extends Context.Service<
  UserSkills,
  {
    /** The skills Piano created, by name. */
    readonly list: Effect.Effect<ReadonlyArray<UserSkill>>;
    readonly create: (request: UserSkillCreate) => Effect.Effect<UserSkill, UserSkillError>;
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
 * The skill named `name` if Piano wrote it: a real directory (not a link) of that name whose own
 * SKILL.md carries the marker and still declares that name.
 */
function piano(root: string, name: string): UserSkill | undefined {
  const dir = join(root, name);
  if (!isDirectory(dir)) return undefined;
  const file = join(dir, "SKILL.md");
  try {
    if (!lstatSync(file).isFile()) return undefined;
    const { frontmatter } = parseFrontmatter(readFileSync(file, "utf8"));
    const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
    if (metadata?.[MARKER_KEY] !== MARKER) return undefined;
    const { description } = frontmatter;
    if (frontmatter.name !== name || typeof description !== "string") return undefined;
    return { name, description };
  } catch {
    return undefined;
  }
}

/** Double-quoted YAML scalars accept JSON string syntax, so any description stays one value. */
const fileOf = ({ name, description, instructions }: UserSkillCreate) =>
  [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    "metadata:",
    `  ${MARKER_KEY}: ${MARKER}`,
    "---",
    "",
    `${instructions.trimEnd()}\n`,
  ].join("\n");

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
        [root(), environment.piDirectory()].flatMap((dir) =>
          loadSkillsFromDir({ dir, source: "user" }).skills.map((skill) => skill.name),
        ),
      );

    const create = Effect.fn("UserSkills.create")(function* (request: UserSkillCreate) {
      const name = request.name.trim();
      const description = request.description.trim();
      const instructions = request.instructions.trim();
      if (!name) return yield* refused("Enter a name.", "name");
      if (name.length > SKILL_NAME_MAX || !SKILL_NAME.test(name))
        return yield* refused(
          "Use lowercase letters and digits, with hyphens between them.",
          "name",
        );
      if (!description) return yield* refused("Enter a description.", "description");
      if (!instructions) return yield* refused("Enter instructions.", "instructions");
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
            writeFileSync(join(dir, "SKILL.md"), fileOf({ name, description, instructions }), {
              flag: "wx",
            });
          } catch (cause) {
            rmSync(dir, { recursive: true, force: true });
            throw cause;
          }
          return { name, description };
        },
        catch: (cause) =>
          cause instanceof UserSkillError ? cause : refused("Could not save the skill."),
      });
    });

    const remove = Effect.fn("UserSkills.remove")(function* (name: string) {
      // The name rule keeps the path inside the skills directory.
      if (!SKILL_NAME.test(name) || !piano(root(), name))
        return yield* refused("Piano did not create this skill.");
      yield* Effect.try({
        try: () => rmSync(join(root(), name), { recursive: true }),
        catch: () => refused("Could not delete the skill."),
      });
    });

    return UserSkills.of({ list, create, remove });
  }),
);
