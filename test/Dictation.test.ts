import assert from "node:assert/strict";
import { test } from "node:test";
import type { VoiceHints } from "../shared/voiceInput.ts";
import {
  createDictation,
  type DictationField,
  type MicrophoneStream,
  type Recorder,
} from "../web/src/lib/dictation.ts";
import { createDrafts, type DraftKey, sessionDraftKey } from "../web/src/lib/messageDraft.ts";

const A = sessionDraftKey({ cwd: "/work/a", sessionId: "session-a" });
const B = sessionDraftKey({ cwd: "/work/b", sessionId: "session-b" });

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A microphone whose tracks remember being stopped. */
function stream() {
  const tracks = [{ stopped: false, stop: () => (tracks[0].stopped = true) }];
  return { getTracks: () => tracks, live: () => tracks.some((t) => !t.stopped) };
}

/** A browser the test drives: it grants the microphone, records and transcribes when told. */
function browser() {
  const drafts = createDrafts();
  const grants: ((s: MicrophoneStream) => void)[] = [];
  const recorders: { recorder: Recorder; speak: (words: string) => void }[] = [];
  const requests: { hints: VoiceHints; heard: string; answer: (text: string) => void }[] = [];
  const toasts: string[] = [];
  const frames: (() => void)[] = [];
  const dictation = createDictation({
    drafts,
    supported: () => true,
    microphone: () => new Promise((grant) => grants.push(grant)),
    record: (_stream, events) => {
      let state: Recorder["state"] = "inactive";
      const recorder: Recorder = {
        get state() {
          return state;
        },
        mimeType: "audio/webm",
        start: () => (state = "recording"),
        stop: () => {
          state = "inactive";
          // As MediaRecorder: the stop event comes later, never inside stop().
          setImmediate(events.stop);
        },
      };
      recorders.push({
        recorder,
        speak: (words) => events.data(new Blob([words], { type: "audio/webm" })),
      });
      return recorder;
    },
    transcribe: async (audio, hints) => {
      const heard = await audio.text();
      return new Promise((answer) => requests.push({ hints, heard, answer }));
    },
    failed: () => toasts.push("failed"),
    notify: { info: (m) => toasts.push(m), error: (m) => toasts.push(m) },
    nextFrame: (run) => frames.push(run),
    setTimeout: () => undefined,
    clearTimeout: () => {},
  });
  return { drafts, dictation, grants, recorders, requests, toasts, frames };
}

/** A textarea showing `key`'s draft, with its cursor at `at`. */
function textarea(at: number) {
  return {
    selectionStart: at,
    selectionEnd: at,
    focused: false,
    focus() {
      this.focused = true;
    },
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
}

test("a recording stopped in one session lands in that session's draft after the composer shows another", async () => {
  const page = browser();
  page.drafts.setText(A, "Fix the bug");
  page.drafts.setText(B, "Unrelated");
  let shown: DraftKey = A;
  const fieldA = textarea(0);
  const names = { A: { project: "alpha" }, B: { project: "beta" } };
  void page.dictation.start(A, {
    session: () => (shown === A ? names.A : names.B),
    field: () => (shown === A ? (fieldA as DictationField) : null),
  });
  page.grants[0](stream());
  await settle();
  page.recorders[0].speak("in the parser");
  page.dictation.stop(A);
  await settle();
  assert.equal(page.dictation.phase(A), "transcribing");

  // The composer shows B while A's transcript is on its way; showing B cancels A's dictation.
  shown = B;
  page.dictation.cancel(A);
  assert.equal(page.dictation.phase(A), "transcribing");
  assert.equal(page.dictation.phase(B), "idle");
  page.requests[0].answer("in the parser");
  await settle();

  assert.equal(page.drafts.get(B).text, "Unrelated");
  assert.equal(page.drafts.get(A).text, "Fix the bug in the parser");
  assert.deepEqual(page.requests[0].hints, { project: "alpha" });
  assert.equal(page.dictation.phase(A), "idle");
});

test("a transcript replaces the selection of the draft's shown textarea and the caret follows it", async () => {
  const page = browser();
  page.drafts.setText(A, "Fix  bug");
  const field = textarea(4);
  void page.dictation.start(A, { session: () => ({}), field: () => field });
  page.grants[0](stream());
  await settle();
  page.recorders[0].speak("the");
  page.dictation.stop(A);
  await settle();
  page.requests[0].answer("the");
  await settle();
  assert.equal(page.drafts.get(A).text, "Fix the bug");
  page.frames.forEach((run) => run());
  assert.equal(field.focused, true);
  assert.equal(field.selectionStart, "Fix the".length);
});

test("a microphone granted after the dictation was cancelled is released at once", async () => {
  const page = browser();
  void page.dictation.start(A, { session: () => ({}), field: () => null });
  assert.equal(page.dictation.phase(A), "starting");
  page.dictation.cancel(A);
  assert.equal(page.dictation.phase(A), "idle");

  const late = stream();
  page.grants[0](late);
  await settle();
  assert.equal(late.live(), false);
  assert.equal(page.recorders.length, 0);
  assert.equal(page.dictation.phase(A), "idle");
});

test("a cancelled recording releases the microphone and puts nothing in the draft", async () => {
  const page = browser();
  page.drafts.setText(A, "Keep this");
  const mic = stream();
  void page.dictation.start(A, { session: () => ({}), field: () => null });
  page.grants[0](mic);
  await settle();
  assert.equal(page.dictation.phase(A), "recording");
  page.recorders[0].speak("words nobody stopped for");

  page.dictation.cancel(A);
  await settle();
  assert.equal(mic.live(), false);
  assert.equal(page.recorders[0].recorder.state, "inactive");
  assert.equal(page.requests.length, 0);
  assert.equal(page.drafts.get(A).text, "Keep this");
  assert.equal(page.dictation.phase(A), "idle");
  assert.deepEqual(page.toasts, []);
});
