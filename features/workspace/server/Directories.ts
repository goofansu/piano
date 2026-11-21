import { access, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { DirectoryError } from "../../../server/shared/Directory.ts";
import { directoryPath } from "../../../server/shared/PiEnv.ts";
import type { DirListing } from "../contracts/folders/http.ts";
import { checkoutHint } from "./worktrees/Worktrees.ts";

const code = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const list = Effect.fn("Directories.list")(function* (
  raw: string,
): Effect.fn.Return<DirListing, DirectoryError> {
  const path = directoryPath(raw || "~");
  const unreadable = (error: unknown) =>
    new DirectoryError({
      detail: code(error) === "EACCES" ? `Cannot read ${raw}: permission denied` : messageOf(error),
    });
  const directory = yield* Effect.tryPromise({
    try: () => stat(path),
    catch: (error) =>
      code(error) === "ENOENT"
        ? new DirectoryError({ detail: `No such directory: ${path}` })
        : unreadable(error),
  });
  if (!directory.isDirectory())
    return yield* new DirectoryError({ detail: `${path} is a file, not a directory` });
  const children = (yield* Effect.tryPromise({
    try: () => readdir(path),
    catch: unreadable,
  })).filter((name) => !name.startsWith("."));
  const directories = yield* Effect.forEach(
    children,
    (name) =>
      Effect.tryPromise(() => stat(join(path, name))).pipe(
        Effect.map((entry) => entry.isDirectory()),
        Effect.orElseSucceed(() => false),
      ),
    { concurrency: 8 },
  );
  const names = children.filter((_, i) => directories[i]);
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const entries = yield* Effect.forEach(
    names,
    (name) =>
      Effect.gen(function* () {
        const full = join(path, name);
        const hasGit = yield* Effect.tryPromise(() => access(join(full, ".git"))).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        const gitSubject = hasGit
          ? (yield* checkoutHint(full, { subjectOnly: true })).subject
          : undefined;
        return { name, path: full, gitSubject };
      }),
    { concurrency: 8 },
  );
  const here = yield* checkoutHint(path);
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    home: homedir(),
    gitSubject: here.subject,
    gitRoot: here.root,
    entries,
  };
});

const make = Effect.fn("Directories.make")(function* (
  raw: string,
): Effect.fn.Return<string, DirectoryError> {
  const path = directoryPath(raw);
  if (path === "/")
    return yield* new DirectoryError({ detail: "Choose a folder below the filesystem root." });
  yield* Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (error) => new DirectoryError({ detail: messageOf(error) }),
  });
  return path;
});

export const Directories = { list, make } as const;
