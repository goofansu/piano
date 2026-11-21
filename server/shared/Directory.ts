import { stat } from "node:fs/promises";
import { Data, Effect } from "effect";
import { directoryPath } from "./PiEnv.ts";

export class DirectoryError extends Data.TaggedError("DirectoryError")<{
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}

export const requireDirectory = Effect.fn("Directories.require")(function* (
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
