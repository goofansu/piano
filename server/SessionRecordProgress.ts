/**
 * SessionRecordProgress: how far a session has processed the Pi records its transport received,
 * and whether a message Pi started still waits for its end event. It owns the rule that Pi's
 * context may replace what Piano shows only when every received record is processed, none arrived
 * since the context was read and no message is open (INV-05). Whether Pi is running is Pi's fact,
 * which SessionReadbacks reads back. Internal to PiSessions, which reports each record here.
 */
import { Deferred, type Duration, Effect } from "effect";
import type { PiRecord } from "./PiRecords.ts";
import { PiSessionError } from "./PiTransport.ts";

export interface SessionRecordProgressOptions {
  /** Records the transport has received: moves before their processing starts. */
  readonly observed: () => number;
  /** How long `drain` waits before failing. */
  readonly drainDeadline?: Duration.Input;
}

export interface SessionRecordProgress {
  /** Records received so far; a read it moved during may already be stale. */
  readonly observed: () => number;
  /** Track a record's message boundaries as it is projected, under the publication lock. */
  readonly project: (record: PiRecord) => void;
  /** One received record is fully processed, whether or not it projected. */
  readonly processed: () => Effect.Effect<void>;
  /** Wait until the records received before now are processed. Fails past the deadline. Never
   * call it under the publication lock: the lock is what processing waits on. */
  readonly drain: Effect.Effect<void, PiSessionError>;
  /** A started message still waits for its end event. */
  readonly messageOpen: () => boolean;
  /** Every received record is processed. */
  readonly caughtUp: () => boolean;
  /** Pi's context read once `observed()` was `since` may replace what is shown: nothing arrived
   * since, everything received is processed and no message is open. Check under the lock. */
  readonly settledSince: (since: number) => boolean;
}

export const makeSessionRecordProgress = ({
  observed,
  drainDeadline = "1 second",
}: SessionRecordProgressOptions): SessionRecordProgress => {
  let processedCount = 0;
  let openMessages = 0;
  // Completed, then replaced, at each processed record; drainers recheck their target.
  let advanced: Deferred.Deferred<void> | undefined;

  const caughtUp = () => processedCount === observed();

  const drain = Effect.gen(function* () {
    const target = observed();
    while (processedCount < target) {
      advanced ??= yield* Deferred.make<void>();
      yield* Deferred.await(advanced);
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: drainDeadline,
      orElse: () =>
        new PiSessionError({
          reason: "timeout",
          detail: "Pi records did not drain. Reopen history before continuing.",
        }),
    }),
  );

  return {
    observed,
    project: ({ type }) => {
      if (type === "message_start") openMessages++;
      if (type === "message_end") openMessages = Math.max(0, openMessages - 1);
      if (type === "agent_settled") openMessages = 0;
    },
    processed: Effect.fnUntraced(function* () {
      processedCount++;
      const previous = advanced;
      advanced = undefined;
      if (previous) yield* Deferred.succeed(previous, undefined);
    }),
    drain,
    messageOpen: () => openMessages > 0,
    caughtUp,
    settledSince: (since) => since === observed() && caughtUp() && openMessages === 0,
  };
};
