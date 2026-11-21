import { endpoint } from "../../endpoint.ts";
import {
  MAX_VOICE_REQUEST_BYTES,
  MAX_VOICE_REQUESTS,
  Transcription,
  TranscriptionRequest,
  VoiceInputSave,
  VoiceInputState,
} from "./voiceInput.ts";

export const voiceInputEndpoints = {
  voiceInput: endpoint({
    method: "GET",
    path: "/api/settings/voice-input",
    response: VoiceInputState,
    noStore: true,
    refused: 400,
    fallback: "Could not load voice input.",
  }),
  saveVoiceInput: endpoint({
    method: "PUT",
    path: "/api/settings/voice-input",
    body: VoiceInputSave,
    invalid: "Invalid voice input setting.",
    response: VoiceInputState,
    noStore: true,
    refused: 400,
    fallback: "Could not save voice input.",
  }),
  transcribe: endpoint({
    method: "POST",
    path: "/api/voice/transcribe",
    body: TranscriptionRequest,
    invalid: "The recording could not be sent. Record a shorter message.",
    response: Transcription,
    noStore: true,
    redact: false,
    refused: 502,
    fallback: "Could not transcribe the recording.",
    upload: {
      bytes: MAX_VOICE_REQUEST_BYTES,
      concurrent: MAX_VOICE_REQUESTS,
      busy: "Voice input is busy. Try again later.",
      tooLarge: "The recording is too long. Record a shorter message.",
      compressed: "Compressed recordings are not supported.",
      unreadable: "Could not read the recording.",
      timedOut: "Recording upload timed out.",
    },
  }),
} as const;
