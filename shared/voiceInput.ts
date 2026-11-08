/**
 * Voice input: the composer records speech and Piano transcribes it with OpenAI, using a key only
 * voice input uses. The key is stored in Piano's database, never in Pi, and never leaves the server.
 */
import { Schema } from "effect";

/** OpenAI's transcription model, which takes a free-form prompt. */
export const TRANSCRIPTION_MODEL = "gpt-transcribe";

/** OpenAI's upload limit, before base64 encoding. */
export const MAX_AUDIO_BYTES = 25_000_000;

/** The longest recording the composer makes; dictation is a message, not a meeting. */
export const MAX_RECORDING_MS = 10 * 60_000;

export const VoiceInputState = Schema.Struct({
  /** On only while a key is saved: removing the key turns voice input off. */
  enabled: Schema.Boolean,
  hasKey: Schema.Boolean,
});
export type VoiceInputState = typeof VoiceInputState.Type;

/**
 * `key` omitted keeps the saved key, a string replaces it, null removes it (and turns voice input
 * off). VoiceInput reads the string as an API key and owns its refusal (literalSecret.ts).
 */
export const VoiceInputSave = Schema.Struct({
  enabled: Schema.Boolean,
  key: Schema.optional(Schema.NullOr(Schema.String)),
});
export type VoiceInputSave = typeof VoiceInputSave.Type;

/** The longest hint, and recording media type, the server accepts; the composer clips to it. */
export const MAX_HINT_LENGTH = 512;

const Short = Schema.String.check(Schema.isMaxLength(MAX_HINT_LENGTH));

/**
 * The recording formats OpenAI reads, with the file extension it recognizes each by. The composer
 * asks the browser for the `requested` ones, in this order; the rest are types a browser may report
 * when left to choose. The server reads only the media type before any `;` parameters.
 */
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

/**
 * Where the speaker is dictating: the server turns it into the transcription prompt, which only
 * steers spelling, never the words.
 */
export const VoiceHints = Schema.Struct({
  project: Schema.optional(Short),
  folder: Schema.optional(Short),
  branch: Schema.optional(Short),
  session: Schema.optional(Short),
});
export type VoiceHints = typeof VoiceHints.Type;

export const TranscriptionRequest = Schema.Struct({
  /** The recording, base64-encoded. */
  audio: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(Math.ceil(MAX_AUDIO_BYTES / 3) * 4),
  ),
  /** The recording's media type, as MediaRecorder reported it. */
  mimeType: Short,
  hints: VoiceHints,
});
export type TranscriptionRequest = typeof TranscriptionRequest.Type;

export const Transcription = Schema.Struct({ text: Schema.String });
export type Transcription = typeof Transcription.Type;
