/**
 * One reader of facts from outside the registry, run single-flight: a request while a read is in
 * flight queues exactly one more read, however many requests arrive during it. The sidebar's Git
 * worktree discovery and its session availability both follow this rule, so it is decided here
 * once, together with who waits for what.
 *
 * A read may ask whether a newer request arrived since it started (`superseded`) and answer
 * `false` to install nothing; the read that request already queued then answers the waiters. A
 * read that fails or dies logs a warning under `name` and counts as installed: the last
 * observation stands, a later request retries, and nobody waiting on `request(done)` hangs.
 */
import { Deferred, Effect, type Scope } from "effect";

export interface CoalescedReader {
  /** Ask for a read. `done` resolves once a read that started after this request has installed. */
  readonly request: (done?: Deferred.Deferred<void>) => Effect.Effect<void>;
}

export interface CoalescedReaderOptions {
  /** Names the reader in the warning a failed read logs. */
  readonly name: string;
  /**
   * One read, answering whether it installed its result. Answer `false` only when `superseded()`
   * is true or after making a request of your own: nothing else would start the read the waiters
   * are then left to.
   */
  readonly read: (superseded: () => boolean) => Effect.Effect<boolean, unknown>;
  /** Reads are forked here, so they end with their owner. */
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
