import { lstatSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";
import { promptFile as templateText } from "../../../shared/features/library/library.ts";
import type {
  Prompt,
  PromptCreate,
  PromptProposal,
  PromptUpdate,
} from "../../../shared/features/library/prompts.ts";
import { agentDir } from "../../shared/PiEnv.ts";
import { type LibraryError, makeLibrary, type Shelved } from "./Library.ts";
import { pianoFolder } from "./PianoFolders.ts";

export const PromptsEnvironment = Context.Reference<{
  directory: string;
  agentDir: () => string;
}>("piano/PromptsEnvironment", {
  defaultValue: () => ({ directory: pianoFolder("prompts"), agentDir }),
});

export class Prompts extends Context.Service<
  Prompts,
  {
    readonly list: Effect.Effect<readonly Prompt[]>;
    readonly propose: (input: PromptCreate) => Effect.Effect<PromptProposal, LibraryError>;
    readonly create: (input: PromptCreate) => Effect.Effect<Prompt, LibraryError>;
    readonly update: (input: PromptUpdate) => Effect.Effect<Prompt, LibraryError>;
    readonly remove: (name: string) => Effect.Effect<void, LibraryError>;
  }
>()("piano/Prompts") {}

const code = (cause: unknown) =>
  cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;

const readPrompt = (name: string, text: string): Prompt => {
  let frontmatter: Record<string, unknown> = {};
  let body = text;
  try {
    ({ frontmatter, body } = parseFrontmatter(text));
  } catch {}
  const first = body.split("\n").find((line) => line.trim()) ?? "";
  const description =
    typeof frontmatter.description === "string" && frontmatter.description
      ? frontmatter.description
      : `${first.slice(0, 60)}${first.length > 60 ? "..." : ""}`;
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
          } catch {}
        }
        return found;
      },
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
