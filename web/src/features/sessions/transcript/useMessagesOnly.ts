import { createPreference, parseJson } from "@/shared/lib/preference";
import { usePreference } from "@/shared/lib/usePreference";

const messagesOnly = createPreference<boolean>({
  key: "piano.messagesOnly",
  decode: (raw) => parseJson(raw) === true,
});

export function useMessagesOnly() {
  return usePreference(messagesOnly);
}
