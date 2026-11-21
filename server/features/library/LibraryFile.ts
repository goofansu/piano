import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Data, Effect, Semaphore } from "effect";

export class LibraryFileRefusal extends Data.TaggedError("LibraryFileRefusal")<{
  readonly reason: "missing" | "changed" | "failed";
}> {}

const writing = Semaphore.makeUnsafe(1);

export const alone: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> =
  Semaphore.withPermits(writing, 1);

const refusal = (reason: LibraryFileRefusal["reason"]) => () => new LibraryFileRefusal({ reason });

export const replace = (
  file: string,
  previous: string,
  text: string,
): Effect.Effect<void, LibraryFileRefusal> =>
  alone(
    Effect.gen(function* () {
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
