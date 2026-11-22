import { Effect } from "effect";
import type { DialogRequest } from "../../server/pi/PiRecords.ts";
import type { makeSessionDialogs } from "../../server/pi/SessionDialogs.ts";
import type { SessionPublication } from "../../server/pi/SessionPublication.ts";

export const publicationContract = (
  publication: SessionPublication,
  dialogs: ReturnType<typeof makeSessionDialogs>,
  request: DialogRequest,
) => {
  // @ts-expect-error
  publication.publish({ _tag: "notice", level: "info", message: "unsafe" });
  // @ts-expect-error
  publication.mergeState({ sessionName: "unsafe" });
  // @ts-expect-error
  publication.locked(Effect.void);
  // @ts-expect-error
  dialogs.opened(request);
  // @ts-expect-error
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
