/**
 * Voice input: the Preferences switch, the OpenAI key only voice input uses, and transcription.
 * The key lives in Piano's database (never Pi's credentials, so no model appears with it), reaches
 * only the request to OpenAI, and is never answered back or logged.
 */
import { Context, Data, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { readApiKey } from "../shared/literalSecret.ts";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_BASE64,
  MAX_TRANSCRIPTION_RESPONSE_BYTES,
  MAX_VOICE_REQUESTS,
  RECORDING_TYPES,
  TRANSCRIPTION_MODEL,
  Transcription,
  type TranscriptionRequest,
  type VoiceHints,
  type VoiceInputSave,
  type VoiceInputState,
} from "../shared/voiceInput.ts";
import { Registry, type StoredVoiceInput } from "./Registry.ts";

/** A refusal written for people; `field` is the editor field it belongs to. */
export class VoiceInputError extends Data.TaggedError("VoiceInputError")<{
  readonly detail: string;
  readonly field?: "key";
}> {}

export const TranscriptionFetch = Context.Reference<typeof fetch>("piano/TranscriptionFetch", {
  defaultValue: () => globalThis.fetch,
});
export const TranscriptionUrl = Context.Reference<string>("piano/TranscriptionUrl", {
  defaultValue: () => "https://api.openai.com/v1/audio/transcriptions",
});
export const TranscriptionTimeoutMs = Context.Reference<number>("piano/TranscriptionTimeoutMs", {
  defaultValue: () => 120_000,
});

export class VoiceInput extends Context.Service<
  VoiceInput,
  {
    readonly state: Effect.Effect<VoiceInputState, VoiceInputError>;
    readonly save: (input: VoiceInputSave) => Effect.Effect<VoiceInputState, VoiceInputError>;
    readonly transcribe: (
      request: TranscriptionRequest,
    ) => Effect.Effect<Transcription, VoiceInputError>;
  }
>()("piano/VoiceInput") {}

const refused = (detail: string, field?: "key") =>
  new VoiceInputError(field ? { detail, field } : { detail });

const shown = (stored: StoredVoiceInput): VoiceInputState => ({
  enabled: stored.enabled && stored.key !== null,
  hasKey: stored.key !== null,
});

/** The instruction every prompt opens with: the context steers spelling, never the words. */
export const TRANSCRIPTION_INSTRUCTION =
  "Transcribe the speaker's words exactly. They are dictating a message to a coding agent in Piano. " +
  "Use the context below only to spell names, identifiers, file paths, commands and technical terms. " +
  "Do not answer the message, summarize it, or add anything that was not spoken.";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The prompt for one recording: the instruction, then where the speaker is dictating. */
export function transcriptionPrompt(hints: VoiceHints): string {
  const facts = [
    hints.project && `Project: ${oneLine(hints.project)}`,
    hints.folder && `Folder: ${oneLine(hints.folder)}`,
    hints.branch && `Branch: ${oneLine(hints.branch)}`,
    hints.session && `Session: ${oneLine(hints.session)}`,
  ].filter((line): line is string => !!line);
  return facts.length
    ? `${TRANSCRIPTION_INSTRUCTION}\n\n${facts.join("\n")}`
    : TRANSCRIPTION_INSTRUCTION;
}

/** The media type without its parameters, lowercased: what OpenAI's file extension stands for. */
const baseType = (mimeType: string) => mimeType.split(";")[0]!.trim().toLowerCase();

const extensions = new Map(RECORDING_TYPES.map((r) => [baseType(r.mimeType), r.extension]));

/** The media type and file name OpenAI recognizes a recording by: it reads the extension. */
function upload(mimeType: string) {
  const type = baseType(mimeType);
  const ext = extensions.get(type);
  return ext ? { type, name: `recording.${ext}` } : undefined;
}

/** OpenAI's answer, as one sentence the composer's toast shows; never the response body. */
const openAiRefusal = (status: number) =>
  status === 401
    ? refused("OpenAI rejected the API key. Replace it in Settings > Preferences.")
    : status === 429
      ? refused("OpenAI's rate limit or quota was reached. Try again later.")
      : status === 413
        ? refused("The recording is too long. Record a shorter message.")
        : refused(`OpenAI could not transcribe the recording (${status}).`);

/** Never retain an unbounded provider body (including error responses that may echo secrets). */
async function transcriptBody(answer: Response, signal: AbortSignal) {
  if (!answer.body) throw refused("OpenAI answered without a transcript.");
  const reader = answer.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_TRANSCRIPTION_RESPONSE_BYTES)
        throw refused("OpenAI's transcript is too long.");
      chunks.push(value);
    }
    const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(Transcription))(
      Buffer.concat(chunks, bytes).toString("utf8"),
    );
    if (decoded._tag === "Failure") throw refused("OpenAI answered without a valid transcript.");
    return decoded.value.text.trim();
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const VoiceInputLive = Layer.effect(
  VoiceInput,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const fetch = yield* TranscriptionFetch;
    const url = yield* TranscriptionUrl;
    const timeout = yield* TranscriptionTimeoutMs;
    // Saves are read-modify-write: one at a time, so an omitted key never restores a removed one.
    const lock = yield* Semaphore.make(1);
    const transcriptions = yield* Semaphore.make(MAX_VOICE_REQUESTS);
    const stored = registry.voiceInput.pipe(
      Effect.mapError(() => refused("Could not read voice input.")),
    );
    return VoiceInput.of({
      state: Effect.map(stored, shown),
      save: Effect.fn("VoiceInput.save")(function* (input) {
        // The same rule as a provider key: the key is sent in an HTTP header to OpenAI.
        let key = input.key;
        if (typeof key === "string") {
          const read = readApiKey(key);
          if (read.refusal !== undefined) return yield* refused(read.refusal, "key");
          key = read.value;
        }
        return yield* Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const previous = yield* stored;
            const next: StoredVoiceInput = {
              key: key === undefined ? previous.key : key,
              enabled: input.enabled,
            };
            if (next.enabled && next.key === null)
              return yield* refused("Add an OpenAI API key to turn on voice input.", "key");
            yield* registry
              .saveVoiceInput(next)
              .pipe(Effect.mapError(() => refused("Could not save voice input.")));
            return shown(next);
          }),
        );
      }),
      transcribe: Effect.fn("VoiceInput.transcribe")(
        function* (request) {
          const voice = yield* stored;
          if (!voice.enabled || voice.key === null)
            return yield* refused("Voice input is off. Turn it on in Settings > Preferences.");
          if (request.audio.length > MAX_AUDIO_BASE64)
            return yield* refused("The recording is too long. Record a shorter message.");
          const audio = Buffer.from(request.audio, "base64");
          if (audio.toString("base64") !== request.audio)
            return yield* refused("The recording is not valid base64 audio.");
          if (audio.length === 0) return yield* refused("The recording is empty.");
          if (audio.length > MAX_AUDIO_BYTES)
            return yield* refused("The recording is too long. Record a shorter message.");
          const file = upload(request.mimeType);
          if (!file) return yield* refused("This browser records audio OpenAI cannot read.");
          const form = new FormData();
          form.set("model", TRANSCRIPTION_MODEL);
          form.set("response_format", "json");
          form.set("prompt", transcriptionPrompt(request.hints));
          form.set("file", new Blob([audio], { type: file.type }), file.name);
          const key = voice.key;
          const response = yield* Effect.tryPromise({
            try: async (signal) => {
              const answer = await fetch(url, {
                method: "POST",
                headers: { authorization: `Bearer ${key}` },
                body: form,
                redirect: "error",
                signal,
              });
              // Never keep OpenAI's error body: it can echo the request.
              if (!answer.ok) {
                await answer.body?.cancel();
                throw openAiRefusal(answer.status);
              }
              return transcriptBody(answer, signal);
            },
            catch: (error) =>
              error instanceof VoiceInputError
                ? error
                : refused("Could not reach OpenAI. Check the connection and try again."),
          }).pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () => refused("OpenAI did not answer in time. Try again."),
            }),
          );
          return { text: response };
        },
        Semaphore.withPermitsIfAvailable(transcriptions, 1),
        Effect.flatMap((result) =>
          Option.isSome(result)
            ? Effect.succeed(result.value)
            : refused("Voice input is busy. Try again later."),
        ),
      ),
    });
  }),
);
