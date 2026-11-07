/**
 * The page's one read of voice input: whether it is on and whether a key is saved. Settings and
 * every composer show this value, so a change saved in Settings shows or hides the mic at once,
 * without a reload. A save is a mutation, so a read that started before it cannot overwrite it;
 * focus reads again, for a change another tab saved. Nothing here depends on React.
 */
// Relative, not @shared: module tests load this file directly in Node.
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
  /** Starts reading, once per page; later calls do nothing. */
  start: () => void;
  refresh: () => Promise<VoiceInputState | undefined>;
  /** Saves `change`; every reader sees the saved state when it resolves. Rejects as the save did. */
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
