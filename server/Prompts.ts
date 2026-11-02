/**
 * Prompts created in Piano. Each is a Pi prompt template, a Markdown file in Piano's own prompts
 * folder beside its database; every Pi child Piano starts loads that folder with
 * `--prompt-template` (main.ts), so the composer offers them as `/name` like any other template.
 * Settings lists this folder alone: Pi's personal and project prompt folders stay Pi's (INV-01),
 * read only to refuse a name Pi already loads, and Pi keeps parsing and expanding templates
 * (INV-12). A running Pi loaded its templates when it
 * started, so a change reaches sessions started from then on.
 */
import { readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import { checkDraft, type DraftField, isName } from "../shared/drafts.ts";
import { promptFile as templateText } from "../shared/library.ts";
import type { Prompt, PromptCreate, PromptUpdate } from "../shared/prompts.ts";
import * as LibraryFile from "./LibraryFile.ts";
import { pianoFolder } from "./PianoFolders.ts";
import { agentDir } from "./PiEnv.ts";

/** A refusal written for people; `field` names the editor field it belongs to, if any. */
export class PromptError extends Data.TaggedError("PromptError")<{
  readonly detail: string;
  readonly field?: DraftField;
}> {}

export const PromptsEnvironment = Context.Reference<{
  /** Piano's prompts folder, beside its database, which every Pi child loads. */
  directory: string;
  /** The other folders Pi loads user prompts from, read only to refuse a name Pi already loads. */
  others: () => readonly string[];
}>("piano/PromptsEnvironment", {
  defaultValue: () => ({
    directory: pianoFolder("prompts"),
    others: () => [join(agentDir(), "prompts")],
  }),
});

/**
 * Whether Pi loads a prompt named `name` from `dir`. Pi's own loader is not exported, so this is
 * its rule for one name: `<name>.md`, a file or a link to one, whose front matter parses. Pi
 * merges Piano's folder after its own and keeps the first prompt of a name, so Piano's would lose.
 */
const loadedFrom = (dir: string, name: string) => {
  const path = join(dir, `${name}.md`);
  try {
    if (!statSync(path).isFile()) return false;
    parseFrontmatter(readFileSync(path, "utf8"));
    return true;
  } catch {
    return false;
  }
};

export class Prompts extends Context.Service<
  Prompts,
  {
    /** Piano's prompts by name, as Pi reads them. */
    readonly list: Effect.Effect<readonly Prompt[], PromptError>;
    /** Save a new prompt; a name already taken, in Piano's folder or one Pi loads before it, is
     * refused, never overwritten. */
    readonly create: (input: PromptCreate) => Effect.Effect<Prompt, PromptError>;
    /** Replace a prompt Piano created; any other name is refused, never created. With
     * `previous`, only that file is replaced: a prompt changed since it was shown is refused, and
     * nothing written. */
    readonly update: (input: PromptUpdate) => Effect.Effect<Prompt, PromptError>;
    /** Delete a prompt; one already gone counts as deleted. */
    readonly remove: (name: string) => Effect.Effect<void, PromptError>;
  }
>()("piano/Prompts") {}

const code = (cause: unknown) =>
  cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;

/** The prompt Pi reads from `text`: front matter's description, else Pi's first-line fallback. */
const readPrompt = (name: string, text: string): Prompt => {
  let frontmatter: Record<string, unknown> = {};
  let body = text;
  try {
    ({ frontmatter, body } = parseFrontmatter(text));
  } catch {
    // Pi skips a file whose front matter does not parse; list it by name so it can be deleted.
  }
  const first = body.split("\n").find((line) => line.trim()) ?? "";
  const description =
    typeof frontmatter.description === "string" && frontmatter.description
      ? frontmatter.description
      : // Pi's fallback: the first non-empty line, cut at 60 characters.
        `${first.slice(0, 60)}${first.length > 60 ? "..." : ""}`;
  return {
    name,
    description,
    file: text,
  };
};

export const PromptsLive = Layer.effect(
  Prompts,
  Effect.gen(function* () {
    const environment = yield* PromptsEnvironment;
    const dir = environment.directory;
    const file = (name: string) => join(dir, `${name}.md`);
    const unreadable = () => new PromptError({ detail: "Could not read prompts." });

    const list = Effect.fn("Prompts.list")(function* () {
      const names = yield* Effect.tryPromise({
        try: () => readdir(dir, { withFileTypes: true }),
        catch: (cause) => cause,
      }).pipe(
        Effect.map((entries) =>
          entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
            .map((entry) => entry.name.slice(0, -3))
            .sort((a, b) => a.localeCompare(b)),
        ),
        Effect.catch((cause) =>
          code(cause) === "ENOENT" ? Effect.succeed([]) : Effect.fail(unreadable()),
        ),
      );
      return yield* Effect.forEach(names, (name) =>
        Effect.tryPromise({
          try: () => readFile(file(name), "utf8"),
          catch: unreadable,
        }).pipe(Effect.map((text) => readPrompt(name, text))),
      );
    });

    const create = Effect.fn("Prompts.create")(function* (input: PromptCreate) {
      const check = checkDraft(input);
      const saved = check.saved;
      if (!saved)
        return yield* new PromptError(check.problem ?? { detail: "Could not save prompt." });
      const name = saved.name;
      const text = templateText(saved);
      const taken = () =>
        new PromptError({ detail: `A prompt named ${name} already exists.`, field: "name" });
      // A name Pi already loads from another folder would hide Piano's prompt behind it.
      if (environment.others().some((other) => loadedFrom(other, name))) return yield* taken();
      yield* Effect.tryPromise({
        // `wx` refuses an existing file, so two creates of one name never overwrite each other.
        try: () =>
          mkdir(dir, { recursive: true }).then(() =>
            writeFile(file(name), text, { encoding: "utf8", flag: "wx" }),
          ),
        catch: (cause) =>
          code(cause) === "EEXIST"
            ? taken()
            : new PromptError({ detail: "Could not save prompt." }),
      });
      return readPrompt(name, text);
    });

    const update = Effect.fn("Prompts.update")(function* (input: PromptUpdate) {
      const check = checkDraft(input);
      const saved = check.saved;
      if (!saved)
        return yield* new PromptError(check.problem ?? { detail: "Could not save prompt." });
      const name = saved.name;
      const text = templateText(saved);
      yield* LibraryFile.replace(file(name), input.previous, text).pipe(
        Effect.mapError(({ reason }) =>
          reason === "missing"
            ? new PromptError({ detail: "Prompt not found.", field: "name" })
            : reason === "changed"
              ? new PromptError({
                  detail: "This prompt changed since it was shown. Review it again.",
                })
              : new PromptError({ detail: "Could not save prompt." }),
        ),
      );
      return readPrompt(name, text);
    });

    const remove = Effect.fn("Prompts.remove")(function* (name: string) {
      // Only a name a prompt could have, so a request never reaches outside the folder.
      if (!isName(name)) return yield* new PromptError({ detail: "Prompt not found." });
      yield* Effect.tryPromise({
        try: () => unlink(file(name)),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          code(cause) === "ENOENT"
            ? Effect.void
            : Effect.fail(new PromptError({ detail: "Could not delete prompt." })),
        ),
        LibraryFile.alone,
      );
    });

    return { list: list(), create, update, remove };
  }),
);
