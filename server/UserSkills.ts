/**
 * Skills the user creates in Piano, kept in Piano's own skills folder beside its database
 * (`<name>/SKILL.md`); every Pi child Piano starts loads that folder with `--skill` (main.ts), so
 * they are Piano's only, as prompts are. Pi owns loading (INV-12); this module writes a new skill's
 * file, replaces the file of one it created, lists the folder and removes a skill from it. Skills elsewhere (`~/.agents/skills`, Pi's own
 * folder, a repository's) are never listed or touched, only read to tell whether Pi loads a name
 * from them first.
 * Nothing here changes a running session: one started from now loads the new set, and a running
 * one on `/reload`.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import { checkDraft, type DraftField } from "../shared/drafts.ts";
import { skillFile as fileOf } from "../shared/library.ts";
import type {
  UserSkill,
  UserSkillCreate,
  UserSkillProposal,
  UserSkillUpdate,
} from "../shared/skills.ts";
import * as LibraryFile from "./LibraryFile.ts";
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
    /** The skills Pi loads from Piano's folder, by the name Pi loads each as. */
    readonly list: Effect.Effect<ReadonlyArray<UserSkill>>;
    /** What saving `request` would do, refused as the save would refuse it; writes nothing. A
     * skill Piano created is updated, keeping its Disable model invocation unless the draft sets
     * it; any other name is created. Either is refused when Pi loads a skill of that name from
     * another folder first. */
    readonly propose: (
      request: UserSkillCreate,
    ) => Effect.Effect<UserSkillProposal, UserSkillError>;
    readonly create: (request: UserSkillCreate) => Effect.Effect<UserSkill, UserSkillError>;
    /** Replaces the SKILL.md of a skill Piano created; any other name is refused, so a skill in
     * another folder Pi loads, or a repository's, is never written over, and so is one Pi loads
     * from another folder first, since the change would never reach a session. With `previous`, only
     * that file is replaced: a skill changed since it was shown is refused, and nothing written. */
    readonly update: (request: UserSkillUpdate) => Effect.Effect<UserSkill, UserSkillError>;
    /** Removes a skill Piano created, with its directory, even one Pi loads from another folder
     * first; any other skill is refused. */
    readonly remove: (name: string) => Effect.Effect<void, UserSkillError>;
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

/** A skill in Piano's folder, with the directory that holds it. */
interface PianoSkill {
  readonly skill: UserSkill;
  readonly dir: string;
}

/**
 * The skills Pi loads from Piano's folder, by the name Pi gives each (INV-12: Pi's own loader, not
 * a copy of its rules), in Piano's layout: `<folder>/<directory>/SKILL.md`, both real, not links,
 * so nothing here reaches outside the folder. A SKILL.md whose declared name differs from its
 * directory's is listed under the name Pi loads it as. Of two that declare one name, only the one
 * Pi loads counts, even when that one is outside Piano's layout and so not listed.
 */
function pianoSkills(root: string): Map<string, PianoSkill> {
  const found = new Map<string, PianoSkill>();
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
        dir,
        skill: {
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

    const list = Effect.sync(() =>
      [...pianoSkills(root()).values()]
        .map(({ skill }) => skill)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );

    /** Names Pi loads from the other user folders, which it loads before Piano's. */
    const elsewhere = () =>
      new Set(
        environment
          .others()
          .flatMap((dir) =>
            loadSkillsFromDir({ dir, source: "user" }).skills.map((skill) => skill.name),
          ),
      );
    /**
     * What a save of `name` meets: the skill Pi loads under that name from Piano's folder, if it
     * is in Piano's layout; whether Piano's folder loads that name at all, or holds a directory of
     * it; and whether Pi loads that name from another folder first, which hides Piano's.
     */
    const placeOf = (name: string) => {
      const piano = pianoSkills(root());
      return {
        current: piano.get(name),
        taken:
          loadSkillsFromDir({ dir: root(), source: "user" }).skills.some((s) => s.name === name) ||
          existsSync(join(root(), name)),
        elsewhere: elsewhere().has(name),
      };
    };
    const shadowed = (name: string) =>
      refused(`Pi loads another skill named ${name} instead of this one.`, "name");

    const propose = Effect.fn("UserSkills.propose")(function* (request: UserSkillCreate) {
      const check = checkDraft(request);
      if (!check.saved)
        return yield* refused(
          check.problem?.detail ?? "Could not save the skill.",
          check.problem?.field,
        );
      const { name } = check.saved;
      const place = placeOf(name);
      const current = place.current;
      const disableModelInvocation =
        request.disableModelInvocation ?? current?.skill.disableModelInvocation ?? false;
      const file = fileOf({ ...check.saved, disableModelInvocation });
      if (current && place.elsewhere) return yield* shadowed(name);
      if (current)
        return {
          change: "update" as const,
          name,
          file,
          previous: current.skill.file,
          disableModelInvocation,
        };
      // The refusals create gives: a name Pi loads anywhere, or a directory of that name.
      if (place.taken || place.elsewhere)
        return yield* refused(`A skill named ${name} already exists.`, "name");
      return { change: "create" as const, name, file, disableModelInvocation };
    });

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
          const place = placeOf(name);
          if (place.taken || place.elsewhere)
            throw refused(`A skill named ${name} already exists.`, "name");
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

    const update = Effect.fn("UserSkills.update")(function* (request: UserSkillUpdate) {
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
      const text = fileOf(saved);
      // Only a skill in Piano's folder, found by the name Pi loads it as.
      const place = placeOf(name);
      const current = place.current;
      if (!current) return yield* refused("Skill not found.", "name");
      if (place.elsewhere) return yield* shadowed(name);
      yield* LibraryFile.replace(join(current.dir, "SKILL.md"), request.previous, text).pipe(
        Effect.mapError(({ reason }) =>
          reason === "missing"
            ? refused("Skill not found.", "name")
            : reason === "changed"
              ? refused("This skill changed since it was shown. Review it again.")
              : refused("Could not save the skill."),
        ),
      );
      return {
        name,
        description: saved.description,
        file: text,
        disableModelInvocation: saved.disableModelInvocation,
      };
    });

    const remove = Effect.fn("UserSkills.remove")(function* (name: string) {
      // Only a skill in Piano's folder, found by the name Pi loads it as, with its directory.
      const current = pianoSkills(root()).get(name);
      if (!current) return yield* refused("Skill not found.");
      yield* Effect.try({
        try: () => rmSync(current.dir, { recursive: true }),
        catch: () => refused("Could not delete the skill."),
      }).pipe(LibraryFile.alone);
    });

    return UserSkills.of({ list, propose, create, update, remove });
  }),
);
