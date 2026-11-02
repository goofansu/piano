/**
 * Prompts created in Piano. Each is a Pi prompt template, a Markdown file in Piano's own prompts
 * folder beside its database; every Pi child Piano starts loads that folder with
 * `--prompt-template` (main.ts), so the composer offers them as `/name` like any other template.
 * Settings lists this folder alone: prompts anywhere else stay Pi's (INV-01), read only to tell
 * whether Pi loads a name from them first (`PiLoads.ts`), and Pi keeps parsing and expanding
 * templates (INV-12). A running Pi loaded its templates when it started, so a change reaches
 * sessions started from then on.
 */
import { lstatSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import { checkDraft, type DraftField, isName } from "../shared/drafts.ts";
import { promptFile as templateText } from "../shared/library.ts";
import type { Prompt, PromptCreate, PromptProposal, PromptUpdate } from "../shared/prompts.ts";
import * as LibraryFile from "./LibraryFile.ts";
import { pianoFolder } from "./PianoFolders.ts";
import { agentDir } from "./PiEnv.ts";
import { loadedBeforePiano } from "./PiLoads.ts";

/** A refusal written for people; `field` names the editor field it belongs to, if any. */
export class PromptError extends Data.TaggedError("PromptError")<{
  readonly detail: string;
  readonly field?: DraftField;
}> {}

export const PromptsEnvironment = Context.Reference<{
  /** Piano's prompts folder, beside its database, which every Pi child loads. */
  directory: string;
  /** Pi's agent folder, whose settings, packages and prompts Pi loads before Piano's folder; read
   * only to refuse a name Pi already loads. */
  agentDir: () => string;
}>("piano/PromptsEnvironment", {
  defaultValue: () => ({ directory: pianoFolder("prompts"), agentDir }),
});

export class Prompts extends Context.Service<
  Prompts,
  {
    /** Piano's prompts by name, as Pi reads them. */
    readonly list: Effect.Effect<readonly Prompt[], PromptError>;
    /** What saving `input` would do, refused as the save would refuse it; writes nothing. A
     * prompt Piano created is updated; any other name is created. Either is refused when Pi
     * loads a prompt of that name from another folder first. */
    readonly propose: (input: PromptCreate) => Effect.Effect<PromptProposal, PromptError>;
    /** Save a new prompt; a name already taken, in Piano's folder or one Pi loads before it, is
     * refused, never overwritten. */
    readonly create: (input: PromptCreate) => Effect.Effect<Prompt, PromptError>;
    /** Replace a prompt Piano created; any other name is refused, never created, and so is one
     * Pi loads from another folder first, since the change would never reach a session. With
     * `previous`, only that file is replaced: a prompt changed since it was shown is refused, and
     * nothing written. */
    readonly update: (input: PromptUpdate) => Effect.Effect<Prompt, PromptError>;
    /** Delete a prompt, even one Pi loads from another folder first; one already gone counts as
     * deleted. */
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

    const taken = (name: string) =>
      new PromptError({ detail: `A prompt named ${name} already exists.`, field: "name" });
    const shadowed = (name: string) =>
      new PromptError({
        detail: `Pi loads another prompt named ${name} instead of this one.`,
        field: "name",
      });
    /**
     * What a save of `name` meets: Piano's own file, something else of that name in Piano's
     * folder, or nothing; and whether Pi loads a prompt of that name from another folder first,
     * which hides Piano's, whether it exists yet or not.
     */
    const placeOf = (name: string) =>
      Effect.tryPromise({
        try: async () => {
          const kind = (() => {
            try {
              return lstatSync(file(name)).isFile() ? ("file" as const) : ("other" as const);
            } catch {
              return "none" as const;
            }
          })();
          const elsewhere = (await loadedBeforePiano("prompt", environment.agentDir(), dir)).has(
            name,
          );
          return { kind, elsewhere };
        },
        catch: () => new PromptError({ detail: "Could not save prompt." }),
      });

    const propose = Effect.fn("Prompts.propose")(function* (input: PromptCreate) {
      const check = checkDraft(input);
      const saved = check.saved;
      if (!saved)
        return yield* new PromptError(check.problem ?? { detail: "Could not save prompt." });
      const name = saved.name;
      const text = templateText(saved);
      const place = yield* placeOf(name);
      // Only a regular file is replaced; anything else of that name refuses the create as well.
      if (place.kind === "file") {
        if (place.elsewhere) return yield* shadowed(name);
        const previous = yield* Effect.tryPromise({
          try: () => readFile(file(name), "utf8"),
          catch: unreadable,
        });
        return { change: "update" as const, name, file: text, previous };
      }
      if (place.kind === "other" || place.elsewhere) return yield* taken(name);
      return { change: "create" as const, name, file: text };
    });

    const create = Effect.fn("Prompts.create")(function* (input: PromptCreate) {
      const check = checkDraft(input);
      const saved = check.saved;
      if (!saved)
        return yield* new PromptError(check.problem ?? { detail: "Could not save prompt." });
      const name = saved.name;
      const text = templateText(saved);
      if ((yield* placeOf(name)).elsewhere) return yield* taken(name);
      yield* Effect.tryPromise({
        // `wx` refuses an existing file, so two creates of one name never overwrite each other.
        try: () =>
          mkdir(dir, { recursive: true }).then(() =>
            writeFile(file(name), text, { encoding: "utf8", flag: "wx" }),
          ),
        catch: (cause) =>
          code(cause) === "EEXIST"
            ? taken(name)
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
      const place = yield* placeOf(name);
      if (place.kind === "file" && place.elsewhere) return yield* shadowed(name);
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

    return { list: list(), propose, create, update, remove };
  }),
);
