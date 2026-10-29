/** Bundled Pi extension: Piano keeps the session it started under that session's ID. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function pianoSession(pi: ExtensionAPI) {
  // Piano owns this child under one session ID (INV-02, INV-07). An extension's newSession,
  // switchSession or fork would replace it behind that ID, so Pi is told to cancel; Piano starts,
  // opens and dispatches sessions itself. Any handler's cancel wins, whatever the load order.
  const refuseReplacement = (_event: unknown, ctx: ExtensionContext) => {
    ctx.ui.notify(
      "Piano keeps this session open. Start or open another session from Piano.",
      "error",
    );
    return { cancel: true };
  };
  pi.on("session_before_switch", refuseReplacement);
  pi.on("session_before_fork", refuseReplacement);
}
