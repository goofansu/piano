/**
 * Changing a file in Piano's library (a prompt template or a skill's SKILL.md) only as the person
 * saw it. `replace` writes over a file only while it is still the text the person was shown: one
 * changed since is refused and nothing is written (a Save applies only to what the user saw,
 * INV-04's rule for answers). It never follows a link out of the folder, and a reader sees the old
 * file or the new one, never a part. Replaces and the deletes run through `alone` take turns across
 * every store in this process, so none lands between another's comparison and its write. Each store keeps its own wording for the
 * refusals.
 */
import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Data, Effect, Semaphore } from "effect";

/** Why a replace wrote nothing: no such regular file, it changed since it was shown, or the
 * write itself failed. */
export class LibraryFileRefusal extends Data.TaggedError("LibraryFileRefusal")<{
  readonly reason: "missing" | "changed" | "failed";
}> {}

/** One lock for the whole library in this process: every store's replaces and deletes take turns. */
const writing = Semaphore.makeUnsafe(1);

/** Run `effect` (a delete) with no replace in between. */
export const alone: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> =
  Semaphore.withPermits(writing, 1);

const refusal = (reason: LibraryFileRefusal["reason"]) => () => new LibraryFileRefusal({ reason });

/** Replace `file` with `text` while it still reads exactly `previous`. */
export const replace = (
  file: string,
  previous: string,
  text: string,
): Effect.Effect<void, LibraryFileRefusal> =>
  alone(
    Effect.gen(function* () {
      // A regular file, not a link out of the folder.
      const existing = yield* Effect.tryPromise({
        try: () => lstat(file),
        catch: refusal("missing"),
      });
      if (!existing.isFile()) return yield* refusal("missing")();
      const current = yield* Effect.tryPromise({
        try: () => readFile(file, "utf8"),
        catch: refusal("missing"),
      });
      if (current !== previous) return yield* refusal("changed")();
      // Written beside it, then renamed over it: a reader sees the old file or the new one.
      const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}`);
      yield* Effect.tryPromise({
        try: () =>
          writeFile(temporary, text, { encoding: "utf8", flag: "wx" }).then(() =>
            rename(temporary, file),
          ),
        catch: refusal("failed"),
      }).pipe(Effect.tapError(() => Effect.promise(() => rm(temporary, { force: true }))));
    }),
  );
