/**
 * Prompts created in Piano. Each is a Pi prompt template, a Markdown file in Piano's own prompts
 * folder beside its database; every Pi child Piano starts loads that folder with
 * `--prompt-template` (main.ts), so the composer offers them as `/name` like any other template.
 * Settings lists this folder alone: Pi's personal and project prompt folders stay Pi's (INV-01),
 * and Pi keeps parsing and expanding templates (INV-12). A running Pi loaded its templates when it
 * started, so a change reaches sessions started from then on.
 */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import { isName } from "../shared/drafts.ts";
import {
  checkPromptDraft,
  type Prompt,
  type PromptCreate,
  type PromptField,
} from "../shared/prompts.ts";
import { pianoFolder } from "./PianoFolders.ts";

/** A refusal written for people; `field` names the editor field it belongs to, if any. */
export class PromptError extends Data.TaggedError("PromptError")<{
  readonly detail: string;
  readonly field?: PromptField;
}> {}

/** Piano's prompts folder, beside its database. */
export const PromptsDir = Context.Reference<string>("piano/PromptsDir", {
  defaultValue: () => pianoFolder("prompts"),
});

export class Prompts extends Context.Service<
  Prompts,
  {
    /** Piano's prompts by name, as Pi reads them. */
    readonly list: Effect.Effect<readonly Prompt[], PromptError>;
    /** Save a new prompt; a name already taken is refused, never overwritten. */
    readonly create: (input: PromptCreate) => Effect.Effect<Prompt, PromptError>;
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

/** The template file: front matter (JSON strings are YAML strings), then the instructions. A prompt
 * always has a description, so the front matter is never empty and instructions starting with `---`
 * stay the instructions. */
const templateText = (input: PromptCreate) => {
  return [
    "---",
    `description: ${JSON.stringify(input.description.trim())}`,
    "---",
    `${input.instructions.trim()}\n`,
  ].join("\n");
};

export const PromptsLive = Layer.effect(
  Prompts,
  Effect.gen(function* () {
    const dir = yield* PromptsDir;
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
      const check = checkPromptDraft(input);
      const saved = check.saved;
      if (!saved)
        return yield* new PromptError(check.problem ?? { detail: "Could not save prompt." });
      const name = saved.name;
      const text = templateText(saved);
      yield* Effect.tryPromise({
        // `wx` refuses an existing file, so two creates of one name never overwrite each other.
        try: () =>
          mkdir(dir, { recursive: true }).then(() =>
            writeFile(file(name), text, { encoding: "utf8", flag: "wx" }),
          ),
        catch: (cause) =>
          code(cause) === "EEXIST"
            ? new PromptError({ detail: `A prompt named ${name} already exists.`, field: "name" })
            : new PromptError({ detail: "Could not save prompt." }),
      });
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
      );
    });

    return { list: list(), create, remove };
  }),
);
