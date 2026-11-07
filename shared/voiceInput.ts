/**
 * Voice input: the composer records speech and Piano transcribes it with OpenAI, using a key only
 * voice input uses. The key is stored in Piano's database, never in Pi, and never leaves the server.
 */
import { Schema } from "effect";

/** OpenAI's transcription model: the one that takes free-form context and keyword hints. */
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

/** `key` omitted keeps the saved key, a string replaces it, null removes it (and turns voice input off). */
export const VoiceInputSave = Schema.Struct({
  enabled: Schema.Boolean,
  key: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(8192)))),
});
export type VoiceInputSave = typeof VoiceInputSave.Type;

const Short = Schema.String.check(Schema.isMaxLength(512));
const Text = Schema.String.check(Schema.isMaxLength(8000));

/**
 * What the composer knows about the session the speaker is dictating into. The server turns it
 * into the transcription prompt and keywords; it only steers spelling, never the words.
 */
export const VoiceHints = Schema.Struct({
  project: Schema.optional(Short),
  folder: Schema.optional(Short),
  branch: Schema.optional(Short),
  session: Schema.optional(Short),
  /** The draft before the cursor, which the dictation continues. */
  draft: Schema.optional(Text),
  /** The latest user and assistant messages, oldest first. */
  recent: Schema.optional(Schema.Array(Text).check(Schema.isMaxLength(8))),
  /** Files the session wrote or edited, latest last. */
  files: Schema.optional(Schema.Array(Short).check(Schema.isMaxLength(200))),
  /** Slash command names, without the slash. */
  commands: Schema.optional(Schema.Array(Short).check(Schema.isMaxLength(500))),
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
