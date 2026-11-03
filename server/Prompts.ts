/**
 * Prompts created in Piano. Each is a Pi prompt template, a Markdown file in Piano's own prompts
 * folder beside its database; every Pi child Piano starts loads that folder with
 * `--prompt-template` (main.ts), so the composer offers them as `/name` like any other template.
 * Settings lists this folder alone: prompts anywhere else stay Pi's (INV-01), read only to tell
 * whether Pi loads a name from them first (`PiLoads.ts`), and Pi keeps parsing and expanding
 * templates (INV-12). A running Pi loaded its templates when it started, so a change reaches
 * sessions started from then on. What a save or delete does is `Library.ts`'s decision; this module
 * is the prompt layout: one `<name>.md` per prompt.
 */
import { lstatSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";
import { promptFile as templateText } from "../shared/library.ts";
import type { Prompt, PromptCreate, PromptProposal, PromptUpdate } from "../shared/prompts.ts";
import { type LibraryError, makeLibrary, type Shelved } from "./Library.ts";
import { pianoFolder } from "./PianoFolders.ts";
import { agentDir } from "./PiEnv.ts";

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
    /** Piano's prompts by name, as Pi reads them; one Piano cannot read is left out. Fails only
     * when the folder cannot be read. */
    readonly list: Effect.Effect<readonly Prompt[], LibraryError>;
    /** What saving `input` would do, refused as the save would refuse it; writes nothing. A
     * prompt Piano created is updated; any other name is created. Either is refused when Pi
     * loads a prompt of that name from another folder first. */
    readonly propose: (input: PromptCreate) => Effect.Effect<PromptProposal, LibraryError>;
    /** Save a new prompt; a name already taken, in Piano's folder or one Pi loads before it, is
     * refused, never overwritten. */
    readonly create: (input: PromptCreate) => Effect.Effect<Prompt, LibraryError>;
    /** Replace a prompt Piano created; any other name is refused, never created, and so is one
     * Pi loads from another folder first, since the change would never reach a session. With
     * `previous`, only that file is replaced: a prompt changed since it was shown is refused, and
     * nothing written. */
    readonly update: (input: PromptUpdate) => Effect.Effect<Prompt, LibraryError>;
    /** Delete a prompt listed in Piano's folder, by the name Pi loads it as, even one Pi loads
     * from another folder first; any other name, or one already gone, is refused. Reads only that
     * prompt, so one Piano cannot read refuses its own delete, never another's. */
    readonly remove: (name: string) => Effect.Effect<void, LibraryError>;
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

    const library = makeLibrary<Prompt, PromptCreate>({
      kind: "prompt",
      folder: () => dir,
      agentDir: environment.agentDir,
      /**
       * Every regular `<name>.md` in the folder, not a link, by the name Pi loads it as. A name
       * Piano would not create, such as `Review`, is still listed, so it can be deleted; one gone
       * since the folder was read, or one Piano cannot read, is not.
       */
      shelf: async () => {
        const names = await readdir(dir, { withFileTypes: true }).then(
          (entries) =>
            entries
              .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
              .map((entry) => entry.name.slice(0, -3)),
          (cause) => {
            if (code(cause) === "ENOENT") return [];
            throw cause;
          },
        );
        const found = new Map<string, Shelved<Prompt>>();
        for (const name of names) {
          try {
            found.set(name, {
              entry: readPrompt(name, await readFile(file(name), "utf8")),
              path: file(name),
            });
          } catch {
            // Gone or unreadable since the folder was read: not listed.
          }
        }
        return found;
      },
      /** Any name: one that is not a file name, such as `../x`, names no entry in the folder. */
      find: async (name) => {
        if (basename(name) !== name || name.includes("\0")) return undefined;
        try {
          if (!lstatSync(file(name)).isFile()) return undefined;
          return { entry: readPrompt(name, await readFile(file(name), "utf8")), path: file(name) };
        } catch (cause) {
          if (code(cause) === "ENOENT") return undefined;
          throw cause;
        }
      },
      occupied: (name) => {
        try {
          lstatSync(file(name));
          return true;
        } catch {
          return false;
        }
      },
      render: (saved) => readPrompt(saved.name, templateText(saved)),
      // `wx` refuses an existing file, so two creates of one name never overwrite each other.
      create: (prompt) =>
        mkdir(dir, { recursive: true }).then(() =>
          writeFile(file(prompt.name), prompt.file, { encoding: "utf8", flag: "wx" }),
        ),
      remove: ({ path }) => unlink(path),
    });

    return {
      list: library.list,
      propose: (input) =>
        library.propose(input).pipe(
          Effect.map(({ change, entry, previous }) => ({
            change,
            name: entry.name,
            file: entry.file,
            ...(previous !== undefined ? { previous } : {}),
          })),
        ),
      create: library.create,
      update: library.update,
      remove: library.remove,
    };
  }),
);
