import { createPreference, parseJson } from "@/lib/preference";
import { usePreference } from "@/lib/usePreference";

/** Whether long lines of code wrap, in Changes and in a file's source alike. The key predates
 * the file view; changing it would forget what users saved. Patches stay intact either way. */
const codeWrap = createPreference<boolean>({
  key: "piano:changes-wrap",
  decode: (raw) => parseJson(raw) === true,
});

export function useCodeWrap() {
  return usePreference(codeWrap);
}
