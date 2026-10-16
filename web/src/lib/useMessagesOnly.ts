import { createPreference, parseJson } from "@/lib/preference";
import { usePreference } from "@/lib/usePreference";

/** Messages only: the transcript hides tool calls and pending text. Off by default. */
const messagesOnly = createPreference<boolean>({
  key: "piano:messages-only",
  decode: (raw) => parseJson(raw) === true,
});

/** A display preference only: the authoritative transcript stays intact. */
export function useMessagesOnly() {
  return usePreference(messagesOnly);
}
