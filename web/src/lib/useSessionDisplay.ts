import { createPreference } from "@/lib/preference";
import type { SessionDisplay } from "@/lib/sessionCommands";
import { usePreference } from "@/lib/usePreference";

const sessionDisplay = createPreference<SessionDisplay>({
  key: "piano:session-display",
  decode: (raw) => (raw === "messages" ? "messages" : "everything"),
  encode: (value) => value,
});

/** A display preference only: the authoritative transcript stays intact. */
export function useSessionDisplay() {
  return usePreference(sessionDisplay);
}
