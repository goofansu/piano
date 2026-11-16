import { useEffect, useSyncExternalStore } from "react";
import { saveVoiceInput, voiceInput } from "./api.ts";
import { createVoiceInputSettings } from "./voiceInputSettings.ts";

export const voiceInputSettings = createVoiceInputSettings({
  load: (signal) => voiceInput({ signal }),
  save: (change) => saveVoiceInput(change),
});

export function useVoiceInput() {
  useEffect(() => voiceInputSettings.start(), []);
  return useSyncExternalStore(voiceInputSettings.subscribe, voiceInputSettings.getState);
}
