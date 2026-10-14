import { Effect } from "effect";
import type { DialogRequest } from "../server/PiRecords.ts";
import type { makeSessionDialogs } from "../server/SessionDialogs.ts";
import type { SessionPublication } from "../server/SessionPublication.ts";

// Compile-only API contract: lock-only mutation must be obtained from a transaction.
// Not executed; npm run typecheck verifies both permitted and rejected calls.
export const publicationContract = (
  publication: SessionPublication,
  dialogs: ReturnType<typeof makeSessionDialogs>,
  request: DialogRequest,
) => {
  // @ts-expect-error Unlocked event publication is not offered.
  publication.publish({ _tag: "notice", level: "info", message: "unsafe" });
  // @ts-expect-error Unlocked state merging is not offered.
  publication.mergeState({ sessionName: "unsafe" });
  // @ts-expect-error An arbitrary effect cannot claim to hold the lock.
  publication.locked(Effect.void);
  // @ts-expect-error Opening a dialog requires the record transaction.
  dialogs.opened(request);
  // @ts-expect-error A structurally similar object is not a publication capability.
  dialogs.opened({ publish: () => Effect.void, mergeState: () => Effect.void }, request);

  return publication.transaction((transaction) =>
    Effect.gen(function* () {
      yield* transaction.mergeState({ sessionName: "safe" });
      yield* transaction.publish({
        _tag: "notice",
        level: "info",
        message: "safe",
      });
      yield* dialogs.opened(transaction, request);
    }),
  );
};
