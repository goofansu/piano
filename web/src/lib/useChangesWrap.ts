import { createPreference, parseJson } from "@/lib/preference";
import { usePreference } from "@/lib/usePreference";

/** A display preference shared by the Changes panel and command palette; patches stay intact. */
const changesWrap = createPreference<boolean>({
  key: "piano:changes-wrap",
  decode: (raw) => parseJson(raw) === true,
});

export function useChangesWrap() {
  return usePreference(changesWrap);
}
