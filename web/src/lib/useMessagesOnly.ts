import { createPreference, parseJson } from "@/lib/preference";
import { usePreference } from "@/lib/usePreference";

const messagesOnly = createPreference<boolean>({
  key: "piano.messagesOnly",
  decode: (raw) => parseJson(raw) === true,
});

export function useMessagesOnly() {
  return usePreference(messagesOnly);
}
