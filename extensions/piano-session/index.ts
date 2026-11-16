import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function pianoSession(pi: ExtensionAPI) {
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
