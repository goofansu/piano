import { Deferred, type Duration, Effect } from "effect";
import type { PiRecord } from "./PiRecords.ts";
import { PiSessionError } from "./PiTransport.ts";

export interface SessionRecordProgressOptions {
  readonly observed: () => number;
  readonly drainDeadline?: Duration.Input;
}

export interface SessionRecordProgress {
  readonly observed: () => number;
  readonly project: (record: PiRecord) => void;
  readonly processed: () => Effect.Effect<void>;
  readonly drain: Effect.Effect<void, PiSessionError>;
  readonly messageOpen: () => boolean;
  readonly caughtUp: () => boolean;
  readonly settledSince: (since: number) => boolean;
}

export const makeSessionRecordProgress = ({
  observed,
  drainDeadline = "1 second",
}: SessionRecordProgressOptions): SessionRecordProgress => {
  let processedCount = 0;
  let openMessages = 0;
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
