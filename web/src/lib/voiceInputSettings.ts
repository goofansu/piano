import type { VoiceInputSave, VoiceInputState } from "../../../shared/voiceInput.ts";
import {
  createObservation,
  type ObservationEnvironment,
  type ObservationState,
} from "./observation.ts";

export interface VoiceInputSettingsOptions {
  load: (signal: AbortSignal) => Promise<VoiceInputState>;
  save: (change: VoiceInputSave) => Promise<VoiceInputState>;
  environment?: ObservationEnvironment;
}

export interface VoiceInputSettings {
  getState: () => ObservationState<VoiceInputState>;
  subscribe: (listener: () => void) => () => void;
  start: () => void;
  refresh: () => Promise<VoiceInputState | undefined>;
  save: (change: VoiceInputSave) => Promise<VoiceInputState | undefined>;
}

export function createVoiceInputSettings({
  load,
  save,
  environment,
}: VoiceInputSettingsOptions): VoiceInputSettings {
  const observation = createObservation<VoiceInputState>({
    load: (signal) => load(signal),
    focus: true,
    environment,
  });
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    observation.start();
    observation.observe("voice-input");
  };
  return {
    getState: observation.getState,
    subscribe: observation.subscribe,
    start,
    refresh: observation.refresh,
    save: (change) => {
      start();
      return observation.mutate(() => save(change));
    },
  };
}
