/**
 * Page-lifetime dictation. The source draft store AND key own every operation, even when machines
 * share IDs. Navigation cancels a live microphone, but Stop commits transcription to that source.
 * Only explicit cancellation/page teardown aborts a committed recording. Nothing auto-sends.
 */
import { MAX_AUDIO_BYTES, MAX_RECORDING_MS, type VoiceHints } from "../../../shared/voiceInput.ts";
import type { DraftKey, Drafts } from "./messageDraft.ts";
import { insertDictation, voiceHints } from "./voiceInput.ts";

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";
export interface MicrophoneStream {
  getTracks: () => readonly { stop: () => void }[];
}
export interface Recorder {
  readonly state: "inactive" | "recording" | "paused";
  readonly mimeType: string;
  start: () => void;
  stop: () => void;
}
export interface DictationField {
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
}
/** A machine's page-memory store is its identity, not an unqualified session ID or cwd. */
export interface DictationTarget {
  drafts: Pick<Drafts, "get" | "setText">;
  key: DraftKey | null;
}
export interface DictationOptions {
  supported: () => boolean;
  microphone: () => Promise<MicrophoneStream>;
  record: (
    stream: MicrophoneStream,
    events: { data: (chunk: Blob) => void; stop: () => void; error: () => void },
  ) => Recorder;
  transcribe: (audio: Blob, hints: VoiceHints, signal: AbortSignal) => Promise<string>;
  failed: (error: unknown) => void;
  notify: { info: (message: string) => void; error: (message: string) => void };
  nextFrame: (run: () => void) => void;
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}
export interface DictationStart {
  /** Snapshot at Stop, before asynchronous recorder events or navigation can change context. */
  session: () => VoiceHints;
  field: () => DictationField | null;
}
export interface Dictation {
  phase: (target: DictationTarget) => DictationPhase;
  subscribe: (listener: () => void) => () => void;
  start: (target: DictationTarget, start: DictationStart) => Promise<void>;
  stop: (target: DictationTarget) => void;
  /** Navigation cancels only uncommitted recording; explicit cancellation also aborts transcription. */
  cancel: (target: DictationTarget, includingTranscription?: boolean) => void;
  cancelRecording: () => void;
  dispose: () => void;
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
  target: DictationTarget;
  start: DictationStart;
  phase: DictationPhase;
  abort: AbortController;
  hints?: VoiceHints;
  stream?: MicrophoneStream;
  recorder?: Recorder;
  limit?: unknown;
}

export function createDictation(options: DictationOptions): Dictation {
  const {
    notify,
    setTimeout: later = (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: clear = (handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  } = options;
  const entries = new Set<Entry>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const find = ({ drafts, key }: DictationTarget) =>
    [...entries].find((entry) => entry.target.drafts === drafts && entry.target.key === key);
  const end = (entry: Entry) => {
    entries.delete(entry);
    changed();
  };
  const letGo = (entry: Entry) => {
    if (entry.limit !== undefined) clear(entry.limit);
    entry.limit = undefined;
    if (entry.stream) release(entry.stream);
    entry.stream = undefined;
  };
  const cancel = (entry: Entry) => {
    // Invalidate BEFORE stop/release: recorder callbacks and promises may still arrive.
    entry.abort.abort();
    end(entry);
    try {
      if (entry.recorder && entry.recorder.state !== "inactive") entry.recorder.stop();
    } catch {
      // Cancellation must still release tracks if a broken recorder refuses Stop.
    } finally {
      letGo(entry);
    }
  };
  const fail = (entry: Entry, message: string) => {
    if (!entries.has(entry)) return;
    cancel(entry);
    notify.error(message);
  };
  const cancelRecording = () => {
    for (const entry of entries) if (entry.phase !== "transcribing") cancel(entry);
  };
  const land = (entry: Entry, transcript: string) => {
    const { drafts, key } = entry.target;
    const draft = drafts.get(key).text;
    const input = entry.start.field();
    const at = input
      ? { start: input.selectionStart, end: input.selectionEnd }
      : { start: draft.length, end: draft.length };
    const next = insertDictation(draft, at, transcript);
    drafts.setText(key, next.text);
    if (!input) return;
    options.nextFrame(() => {
      if (
        entry.abort.signal.aborted ||
        entry.start.field() !== input ||
        drafts.get(key).text !== next.text
      )
        return;
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
    });
  };
  const commit = (entry: Entry) => {
    if (entry.phase === "transcribing") return;
    entry.hints = voiceHints(entry.start.session());
    entry.phase = "transcribing";
    changed();
  };
  const stop = (entry: Entry) => {
    if (entry.phase !== "recording") return;
    commit(entry);
    try {
      entry.recorder!.stop();
    } catch {
      fail(entry, "Could not finish recording.");
    } finally {
      letGo(entry);
    }
  };
  const finish = async (entry: Entry, audio: Blob) => {
    try {
      if (!audio.size) {
        notify.info("No speech was heard.");
        return;
      }
      const text = await options.transcribe(audio, entry.hints!, entry.abort.signal);
      if (!entries.has(entry)) return;
      if (!text) notify.info("No speech was heard.");
      else land(entry, text);
    } catch (error) {
      if (entries.has(entry)) options.failed(error);
    } finally {
      if (entries.has(entry)) end(entry);
    }
  };
  return {
    phase: (target) => find(target)?.phase ?? "idle",
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start(target, start) {
      if (!target.key || find(target)) return;
      if (!options.supported()) return notify.error(UNSUPPORTED);
      // At most one permission request/active microphone per page, across all machine stores.
      cancelRecording();
      const entry: Entry = { target, start, phase: "starting", abort: new AbortController() };
      entries.add(entry);
      changed();
      let stream: MicrophoneStream;
      try {
        stream = await options.microphone();
      } catch (error) {
        if (entries.has(entry)) fail(entry, microphoneRefusal(error));
        return;
      }
      if (!entries.has(entry)) return release(stream);
      entry.stream = stream;
      const chunks: Blob[] = [];
      let bytes = 0;
      try {
        const recorder = options.record(stream, {
          data: (chunk) => {
            if (!entries.has(entry)) return;
            bytes += chunk.size;
            if (bytes > MAX_AUDIO_BYTES) {
              chunks.length = 0;
              fail(entry, "The recording is too long. Record a shorter message.");
            } else chunks.push(chunk);
          },
          stop: () => {
            letGo(entry);
            if (!entries.has(entry)) return;
            // Unexpected track termination is a failure, not implicit consent to upload.
            if (entry.phase !== "transcribing") return fail(entry, "Recording ended unexpectedly.");
            const audio = new Blob(chunks, { type: recorder.mimeType });
            chunks.length = 0;
            void finish(entry, audio);
          },
          error: () => fail(entry, "Could not record audio."),
        });
        entry.recorder = recorder;
        recorder.start();
        entry.phase = "recording";
        entry.limit = later(() => {
          if (!entries.has(entry) || entry.phase !== "recording") return;
          notify.info("Recording stopped at 10 minutes.");
          stop(entry);
        }, MAX_RECORDING_MS);
        changed();
      } catch {
        fail(entry, "Could not start recording.");
      }
    },
    stop(target) {
      const entry = find(target);
      if (entry) stop(entry);
    },
    cancel(target, includingTranscription = false) {
      const entry = find(target);
      if (entry && (includingTranscription || entry.phase !== "transcribing")) cancel(entry);
    },
    cancelRecording,
    dispose() {
      for (const entry of entries) cancel(entry);
    },
  };
}
