import { useEffect, useSyncExternalStore } from "react";
import { saveVoiceInput, voiceInput } from "./api.ts";
import { createVoiceInputSettings } from "./voiceInputSettings.ts";

/** The page's voice input setting, shared by Settings and every composer. */
export const voiceInputSettings = createVoiceInputSettings({
  load: (signal) => voiceInput({ signal }),
  save: (change) => saveVoiceInput(change),
});

/** Voice input as last read or saved; reading starts with the first component that asks. */
export function useVoiceInput() {
  useEffect(() => voiceInputSettings.start(), []);
  return useSyncExternalStore(voiceInputSettings.subscribe, voiceInputSettings.getState);
}
