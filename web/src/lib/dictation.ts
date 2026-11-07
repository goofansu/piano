/**
 * Dictation into a draft: the microphone, the recording and its transcript, for every composer on
 * the page. A dictation belongs to the draft it started in, never to whichever draft the composer
 * shows when it ends:
 *
 * - A recording not yet stopped (asking for the microphone, or recording) is cancelled when its
 *   composer switches to another draft or goes away: the microphone is released, the audio is
 *   dropped and nothing is transcribed. A microphone granted after the cancel is released at once.
 * - A recording the user stopped is transcribed with the hints of the session it started in, and
 *   its transcript lands in that draft even if the composer has moved on: the user spoke for it.
 *   While the draft's textarea is shown, the transcript replaces its selection and the caret
 *   follows it; otherwise it is added at the draft's end.
 *
 * Browser APIs, the transcription request and toasts are injected. Nothing here depends on React.
 */
// Relative, not @shared: module tests load this file directly in Node.
import { MAX_RECORDING_MS } from "../../../shared/voiceInput.ts";
import type { VoiceHints } from "../../../shared/voiceInput.ts";
import type { DraftKey, Drafts } from "./messageDraft.ts";
import { insertDictation, type VoiceSession, voiceHints } from "./voiceInput.ts";

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

/** The microphone's audio; stopping every track releases it. */
export interface MicrophoneStream {
  getTracks: () => readonly { stop: () => void }[];
}

/** A recording of a stream; `stop` ends it, after which its last data and then its stop arrive. */
export interface Recorder {
  readonly state: "inactive" | "recording" | "paused";
  /** The audio format it records; empty when the browser has not said. */
  readonly mimeType: string;
  start: () => void;
  stop: () => void;
}

/** The textarea a draft is edited in, while that draft is the one shown. */
export interface DictationField {
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
}

export interface DictationOptions {
  drafts: Pick<Drafts, "get" | "setText">;
  /** False where this browser cannot record (no microphone API, or not a secure context). */
  supported: () => boolean;
  microphone: () => Promise<MicrophoneStream>;
  /** Records `stream`, handing each non-empty chunk to `data` and calling `stop` when it ends. */
  record: (
    stream: MicrophoneStream,
    events: { data: (chunk: Blob) => void; stop: () => void },
  ) => Recorder;
  /** The transcript of `audio`, empty when no speech was heard. */
  transcribe: (audio: Blob, hints: VoiceHints) => Promise<string>;
  /** A transcription failed; the caller tells the user. */
  failed: (error: unknown) => void;
  notify: { info: (message: string) => void; error: (message: string) => void };
  /** Runs after the next render, when a changed draft is in its textarea. */
  nextFrame: (run: () => void) => void;
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface DictationStart {
  /** Where the draft is spoken, read when the recording stops; only that session's names. */
  session: () => VoiceSession;
  /** The draft's textarea while it is the one shown, else null. */
  field: () => DictationField | null;
}

export interface Dictation {
  /** The draft's dictation; `idle` when there is none. */
  phase: (key: DraftKey | null) => DictationPhase;
  subscribe: (listener: () => void) => () => void;
  /** Asks for the microphone and records for `key`; does nothing while `key` already dictates. */
  start: (key: DraftKey | null, start: DictationStart) => Promise<void>;
  /** Stops `key`'s recording; its transcript lands in `key`'s draft. */
  stop: (key: DraftKey | null) => void;
  /** Drops `key`'s recording not yet stopped, releasing the microphone; a transcription stays. */
  cancel: (key: DraftKey | null) => void;
}

export const UNSUPPORTED =
  "This browser cannot record audio here. Voice input needs HTTPS or localhost.";

const microphoneRefusal = (error: unknown) =>
  error instanceof DOMException && error.name === "NotAllowedError"
    ? "Allow microphone access to use voice input."
    : error instanceof DOMException && error.name === "NotFoundError"
      ? "No microphone found."
      : "Could not start recording.";

const release = (stream: MicrophoneStream) => {
  for (const track of stream.getTracks()) track.stop();
};

interface Entry {
  phase: DictationPhase;
  stream?: MicrophoneStream;
  recorder?: Recorder;
  limit?: unknown;
}

export function createDictation(options: DictationOptions): Dictation {
  const {
    drafts,
    notify,
    setTimeout: later = (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: clear = (handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  } = options;
  const entries = new Map<DraftKey, Entry>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const notifyListener of listeners) notifyListener();
  };
  const set = (entry: Entry, phase: DictationPhase) => {
    entry.phase = phase;
    changed();
  };
  const end = (key: DraftKey, entry: Entry) => {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    changed();
  };
  /** Releases the microphone and the time limit; the recorder may still deliver its stop. */
  const letGo = (entry: Entry) => {
    if (entry.limit !== undefined) clear(entry.limit);
    entry.limit = undefined;
    if (entry.stream) release(entry.stream);
    entry.stream = undefined;
  };

  const land = (key: DraftKey, field: () => DictationField | null, transcript: string) => {
    const draft = drafts.get(key).text;
    // Where the cursor is now: typing may have moved it while the transcript was on its way.
    const input = field();
    const at = input
      ? { start: input.selectionStart, end: input.selectionEnd }
      : { start: draft.length, end: draft.length };
    const next = insertDictation(draft, at, transcript);
    drafts.setText(key, next.text);
    if (!input) return;
    options.nextFrame(() => {
      const target = field();
      if (!target) return;
      target.focus();
      target.setSelectionRange(next.caret, next.caret);
    });
  };

  const finish = async (key: DraftKey, entry: Entry, start: DictationStart, audio: Blob) => {
    if (audio.size === 0) return end(key, entry);
    set(entry, "transcribing");
    try {
      const text = await options.transcribe(audio, voiceHints(start.session()));
      if (!text) notify.info("No speech was heard.");
      else land(key, start.field, text);
    } catch (error) {
      options.failed(error);
    } finally {
      end(key, entry);
    }
  };

  return {
    phase: (key) => (key && entries.get(key)?.phase) || "idle",
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start(key, start) {
      if (!key || entries.has(key)) return;
      if (!options.supported()) {
        notify.error(UNSUPPORTED);
        return;
      }
      const entry: Entry = { phase: "starting" };
      entries.set(key, entry);
      changed();
      let stream: MicrophoneStream;
      try {
        stream = await options.microphone();
      } catch (error) {
        if (entries.get(key) !== entry) return;
        end(key, entry);
        notify.error(microphoneRefusal(error));
        return;
      }
      // Cancelled while the browser asked: the microphone is not kept a moment longer.
      if (entries.get(key) !== entry) return release(stream);
      entry.stream = stream;
      const chunks: Blob[] = [];
      const recorder = options.record(stream, {
        data: (chunk) => chunks.push(chunk),
        stop: () => {
          letGo(entry);
          if (entries.get(key) !== entry) return;
          void finish(
            key,
            entry,
            start,
            new Blob(chunks, { type: recorder.mimeType || "audio/webm" }),
          );
        },
      });
      entry.recorder = recorder;
      entry.limit = later(() => {
        if (recorder.state === "inactive") return;
        notify.info("Recording stopped at 10 minutes.");
        recorder.stop();
      }, MAX_RECORDING_MS);
      recorder.start();
      set(entry, "recording");
    },
    stop(key) {
      const recorder = key && entries.get(key)?.recorder;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    },
    cancel(key) {
      const entry = key && entries.get(key);
      if (!key || !entry || entry.phase === "transcribing") return;
      end(key, entry);
      letGo(entry);
      if (entry.recorder && entry.recorder.state !== "inactive") entry.recorder.stop();
    },
  };
}
