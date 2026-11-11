import { createPreference, parseJson } from "@/lib/preference";
import { usePreference } from "@/lib/usePreference";

/** Whether long lines of code wrap, in Changes and in a file's source alike. Patches stay intact
 * either way. */
const codeWrap = createPreference<boolean>({
  key: "piano.codeWrap",
  decode: (raw) => parseJson(raw) === true,
});

export function useCodeWrap() {
  return usePreference(codeWrap);
}
