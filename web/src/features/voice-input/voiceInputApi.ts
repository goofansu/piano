import { voiceInputEndpoints } from "../../../../shared/features/voice-input/http.ts";
import { call, type RequestOptions } from "../../shared/transport/api.ts";

export const voiceInput = (options?: RequestOptions) =>
  call(voiceInputEndpoints.voiceInput, {}, options);

export const saveVoiceInput = (body: typeof voiceInputEndpoints.saveVoiceInput.body.Type) =>
  call(voiceInputEndpoints.saveVoiceInput, { body });

export const transcribe = (
  body: typeof voiceInputEndpoints.transcribe.body.Type,
  options?: RequestOptions,
) => call(voiceInputEndpoints.transcribe, { body }, options);
