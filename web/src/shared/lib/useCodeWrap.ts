import { createPreference, parseJson } from "@/shared/lib/preference";
import { usePreference } from "@/shared/lib/usePreference";

const codeWrap = createPreference<boolean>({
  key: "piano.codeWrap",
  decode: (raw) => parseJson(raw) === true,
});

export function useCodeWrap() {
  return usePreference(codeWrap);
}
