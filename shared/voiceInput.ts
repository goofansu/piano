import { Schema } from "effect";

export const TRANSCRIPTION_MODEL = "gpt-transcribe";

export const MAX_AUDIO_BYTES = 25_000_000;
export const MAX_AUDIO_BASE64 = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
export const MAX_VOICE_REQUEST_BYTES = MAX_AUDIO_BASE64 + 32 * 1024;
export const MAX_TRANSCRIPTION_RESPONSE_BYTES = 1024 * 1024;
export const MAX_TRANSCRIPTION_LENGTH = 64 * 1024;
export const MAX_VOICE_REQUESTS = 2;

export const MAX_RECORDING_MS = 10 * 60_000;

export const VoiceInputState = Schema.Struct({
  enabled: Schema.Boolean,
  hasKey: Schema.Boolean,
});
export type VoiceInputState = typeof VoiceInputState.Type;

export const VoiceInputSave = Schema.Struct({
  enabled: Schema.Boolean,
  key: Schema.optional(Schema.NullOr(Schema.String)),
});
export type VoiceInputSave = typeof VoiceInputSave.Type;

export const MAX_HINT_LENGTH = 512;

const Short = Schema.String.check(Schema.isMaxLength(MAX_HINT_LENGTH));

export const RECORDING_TYPES: ReadonlyArray<{
  readonly mimeType: string;
  readonly extension: string;
  readonly requested: boolean;
}> = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm", requested: true },
  { mimeType: "audio/webm", extension: "webm", requested: true },
  { mimeType: "audio/mp4", extension: "mp4", requested: true },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg", requested: true },
  { mimeType: "video/webm", extension: "webm", requested: false },
  { mimeType: "video/mp4", extension: "mp4", requested: false },
  { mimeType: "audio/x-m4a", extension: "m4a", requested: false },
  { mimeType: "audio/m4a", extension: "m4a", requested: false },
  { mimeType: "audio/mpeg", extension: "mp3", requested: false },
  { mimeType: "audio/wav", extension: "wav", requested: false },
  { mimeType: "audio/x-wav", extension: "wav", requested: false },
];

export const VoiceHints = Schema.Struct({
  project: Schema.optional(Short),
  folder: Schema.optional(Short),
  branch: Schema.optional(Short),
  session: Schema.optional(Short),
});
export type VoiceHints = typeof VoiceHints.Type;

export const TranscriptionRequest = Schema.Struct({
  audio: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_AUDIO_BASE64)),
  mimeType: Short,
  hints: VoiceHints,
});
export type TranscriptionRequest = typeof TranscriptionRequest.Type;

export const Transcription = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(MAX_TRANSCRIPTION_LENGTH)),
});
export type Transcription = typeof Transcription.Type;
