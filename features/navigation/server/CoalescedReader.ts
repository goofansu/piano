import { Deferred, Effect, type Scope } from "effect";

export interface CoalescedReader {
  readonly request: (done?: Deferred.Deferred<void>) => Effect.Effect<void>;
}

export interface CoalescedReaderOptions {
  readonly name: string;
  readonly read: (superseded: () => boolean) => Effect.Effect<boolean, unknown>;
  readonly scope: Scope.Scope;
}

export const makeCoalescedReader = ({
  name,
  read,
  scope,
}: CoalescedReaderOptions): CoalescedReader => {
  let running = false;
  let requested = 0;
  let waiters: Array<{ readonly target: number; readonly done: Deferred.Deferred<void> }> = [];

  const reads: Effect.Effect<void> = Effect.gen(function* () {
    while (true) {
      const version = requested;
      const installed = yield* read(() => version !== requested).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`${name} failed`, cause).pipe(Effect.as(true)),
        ),
      );
      if (installed) {
        const done = waiters.filter((w) => w.target <= version);
        waiters = waiters.filter((w) => w.target > version);
        yield* Effect.forEach(done, (w) => Deferred.succeed(w.done, undefined));
      }
      if (version === requested) {
        running = false;
        return;
      }
    }
  });

  return {
    request: (done) =>
      Effect.suspend(() => {
        const target = ++requested;
        if (done) waiters.push({ target, done });
        if (running) return Effect.void;
        running = true;
        return Effect.asVoid(Effect.forkIn(reads, scope));
      }),
  };
};
