/**
 * Serializes reads of external facts. Requests arriving during a read coalesce into one trailing
 * read, so each requester can wait for an observation begun after its request without starting
 * competing reads. Used for sidebar Git discovery and session availability.
 */
import { Deferred, Effect, type Scope } from "effect";

export interface CoalescedReader {
  /** Schedule a read without waiting for it. If supplied, `done` resolves after a read begun
   * after this request installs a result or fails. Failure leaves the last observation intact;
   * completion is not proof of a fresh result. */
  readonly request: (done?: Deferred.Deferred<void>) => Effect.Effect<void>;
}

export interface CoalescedReaderOptions {
  /** Names the reader in the warning a failed read logs. */
  readonly name: string;
  /**
   * Return true after installing a result. Return false only if another read is already queued
   * (`superseded()` is true, or this callback requested one); waiters then await that read.
   * Failures and defects are logged under `name` and release waiters as if a result was installed.
   * There is no automatic retry after failure.
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
