import { createPreference, parseJson } from "@/lib/preference";
import { usePreference } from "@/lib/usePreference";

const codeWrap = createPreference<boolean>({
  key: "piano.codeWrap",
  decode: (raw) => parseJson(raw) === true,
});

export function useCodeWrap() {
  return usePreference(codeWrap);
}
