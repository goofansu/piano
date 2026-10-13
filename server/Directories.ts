/**
 * The filesystem as the folder picker and folder registration see it: listing a directory's
 * subdirectories with Git hints, creating one, and requiring that a path names a directory.
 * Callers name a directory in their own spelling (`~/x`, `/home/me/x/`); answers carry the one
 * path `directoryPath` makes of it. Every failure is a `DirectoryError` whose `detail` is the text
 * shown to the person. Git details stay behind Worktrees.
 */
import { access, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Data, Effect } from "effect";
import type { DirListing } from "../shared/wire.ts";
import { directoryPath } from "./PiEnv.ts";
import { checkoutHint } from "./Worktrees.ts";

/** A directory could not be listed, created or found; `detail` is the text shown to the person. */
export class DirectoryError extends Data.TaggedError("DirectoryError")<{
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}

const code = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Subdirectories for the folder picker, with Git HEAD subjects for checkouts (as Shelley does). Hidden folders are skipped. */
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
  // Follow directory symlinks, with bounded IO and no synchronous filesystem waits.
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

/** Create the directory and any missing parents (mkdir -p); answers with its path. */
const make = Effect.fn("Directories.make")(function* (
  raw: string,
): Effect.fn.Return<string, DirectoryError> {
  const path = directoryPath(raw);
  yield* Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (error) => new DirectoryError({ detail: messageOf(error) }),
  });
  return path;
});

/** The path, when it names an existing directory (following links). */
const requireDirectory = Effect.fn("Directories.require")(function* (
  raw: string,
): Effect.fn.Return<string, DirectoryError> {
  const path = directoryPath(raw);
  const isDirectory = yield* Effect.tryPromise(() => stat(path)).pipe(
    Effect.map((entry) => entry.isDirectory()),
    Effect.orElseSucceed(() => false),
  );
  if (!isDirectory) return yield* new DirectoryError({ detail: `Not a directory: ${path}` });
  return path;
});

export const Directories = { list, make, require: requireDirectory } as const;
