import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_AUDIO_BYTES, type VoiceHints } from "../shared/voiceInput.ts";
import {
  createDictation,
  type DictationOptions,
  type DictationStart,
  type MicrophoneStream,
  type Recorder,
} from "../web/src/lib/dictation.ts";
import { createDrafts, NEW_SESSION_DRAFT, sessionDraftKey } from "../web/src/lib/messageDraft.ts";

const A = sessionDraftKey({ cwd: "/work/a", sessionId: "same-session" });
const B = sessionDraftKey({ cwd: "/work/b", sessionId: "other-session" });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const context: DictationStart = { session: () => ({}), field: () => null };
function stream() {
  const tracks = [{ stopped: false, stop: () => (tracks[0].stopped = true) }];
  return { getTracks: () => tracks, live: () => tracks.some((t) => !t.stopped) };
}
function browser(overrides: Partial<DictationOptions> = {}) {
  const drafts = createDrafts();
  const a = { drafts, key: A },
    b = { drafts, key: B };
  const grants: ((s: MicrophoneStream) => void)[] = [];
  const recorders: { recorder: Recorder; data: (chunk: Blob) => void; error: () => void }[] = [];
  const requests: {
    hints: VoiceHints;
    heard: string;
    signal: AbortSignal;
    answer: (text: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  const toasts: string[] = [];
  const frames: (() => void)[] = [];
  const timers = new Set<() => void>();
  const dictation = createDictation({
    supported: () => true,
    microphone: () => new Promise((grant) => grants.push(grant)),
    record: (_stream, events) => {
      let state: Recorder["state"] = "inactive";
      const recorder: Recorder = {
        get state() {
          return state;
        },
        mimeType: "audio/webm",
        start: () => {
          state = "recording";
        },
        stop: () => {
          state = "inactive";
          // Final audio and stop are asynchronous, as in MediaRecorder.
          setImmediate(() => {
            events.data(new Blob(["final"]));
            events.stop();
          });
        },
      };
      recorders.push({ recorder, data: events.data, error: events.error });
      return recorder;
    },
    transcribe: async (audio, hints, signal) => {
      const heard = await audio.text();
      return new Promise((answer, reject) =>
        requests.push({ hints, heard, signal, answer, reject }),
      );
    },
    failed: () => toasts.push("failed"),
    notify: { info: (m) => toasts.push(m), error: (m) => toasts.push(m) },
    nextFrame: (run) => frames.push(run),
    setTimeout: (run) => {
      timers.add(run);
      return run;
    },
    clearTimeout: (run) => {
      timers.delete(run as () => void);
    },
    ...overrides,
  });
  const begin = async (target = a, start = context) => {
    const mic = stream();
    const started = dictation.start(target, start);
    grants.at(-1)!(mic);
    await started;
    return mic;
  };
  return { a, b, drafts, dictation, grants, recorders, requests, toasts, frames, timers, begin };
}
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

test("Stop commits source hints before navigation and final recorder events", async () => {
  const p = browser();
  p.drafts.setText(A, "Fix the bug");
  p.drafts.setText(B, "Unrelated");
  let names = { project: "alpha" };
  await p.begin(p.a, { ...context, session: () => names });
  p.dictation.stop(p.a);
  names = { project: "beta" };
  p.dictation.cancel(p.a);
  assert.equal(p.dictation.phase(p.a), "transcribing");
  await settle();
  assert.equal(p.requests[0].heard, "final", "waits for the last audio chunk");
  assert.deepEqual(p.requests[0].hints, { project: "alpha" });
  p.requests[0].answer("in the parser");
  await settle();
  assert.equal(p.drafts.get(A).text, "Fix the bug in the parser");
  assert.equal(p.drafts.get(B).text, "Unrelated");
  assert.equal(p.dictation.phase(p.a), "idle");
});

test("Local and two peers with identical session and New keys never share a result", async () => {
  for (const key of [A, NEW_SESSION_DRAFT]) {
    const p = browser();
    const owners = [p.drafts, createDrafts(), createDrafts()];
    for (const [i, drafts] of owners.entries()) {
      drafts.setText(key, `draft-${i}`);
      const target = { drafts, key };
      await p.begin(target);
      p.dictation.stop(target);
      p.dictation.cancel(target);
      await settle();
    }
    // Out-of-order completions still address their original store and key.
    for (const i of [2, 0, 1]) p.requests[i].answer(`spoken-${i}`);
    await settle();
    owners.forEach((drafts, i) => assert.equal(drafts.get(key).text, `draft-${i} spoken-${i}`));
  }
});

test("selection insertion follows current typing; a delayed frame never focuses another field", async () => {
  const p = browser();
  const field = textarea(4);
  let shown: ReturnType<typeof textarea> | null = field;
  await p.begin(p.a, { ...context, field: () => shown });
  p.dictation.stop(p.a);
  await settle();
  p.drafts.setText(A, "Fix old bug");
  field.selectionEnd = 7;
  p.requests[0].answer("the");
  await settle();
  assert.equal(p.drafts.get(A).text, "Fix the bug");
  const other = textarea(0);
  shown = other;
  p.frames.forEach((run) => run());
  assert.equal(field.focused, false);
  assert.equal(other.focused, false);
});

test("caret follows an unchanged visible field, but not typing or Send after insertion", async () => {
  for (const edit of [false, true]) {
    const p = browser();
    const field = textarea(0);
    await p.begin(p.a, { ...context, field: () => field });
    p.dictation.stop(p.a);
    await settle();
    p.requests[0].answer("hello");
    await settle();
    if (edit) p.drafts.setText(A, "new typing");
    p.frames.forEach((run) => run());
    assert.equal(field.focused, !edit);
    if (!edit) assert.equal(field.selectionStart, 5);
  }
});

test("a transcript arriving after Send is a new unsent addition", async () => {
  const p = browser();
  p.drafts.setText(A, "send this");
  await p.begin();
  p.dictation.stop(p.a);
  await settle();
  let sends = 0;
  p.drafts.submit(A, () => {
    sends++;
    return "sent";
  });
  p.requests[0].answer("later words");
  await settle();
  assert.equal(p.drafts.get(A).text, "later words");
  assert.equal(sends, 1);
});

test("late permission is released and a second machine cancels the first microphone", async () => {
  const p = browser();
  void p.dictation.start(p.a, context);
  const other = { drafts: createDrafts(), key: A };
  const started = p.dictation.start(other, context);
  const late = stream(),
    live = stream();
  p.grants[0](late);
  p.grants[1](live);
  await started;
  assert.equal(late.live(), false);
  assert.equal(p.recorders.length, 1);
  p.dictation.cancelRecording();
  await settle();
  assert.equal(live.live(), false);
  assert.equal(p.timers.size, 0);
  assert.equal(p.requests.length, 0);
});

test("explicit cancel/teardown aborts transcription and stale completions cannot settle a new operation", async () => {
  for (const teardown of [false, true]) {
    const p = browser();
    const mic = await p.begin();
    p.dictation.stop(p.a);
    await settle();
    if (teardown) p.dictation.dispose();
    else p.dictation.cancel(p.a, true);
    assert.equal(p.requests[0].signal.aborted, true);
    assert.equal(mic.live(), false);
    await p.begin();
    p.requests[0].answer("stale");
    await settle();
    assert.equal(p.drafts.get(A).text, "");
    assert.equal(p.dictation.phase(p.a), "recording");
    p.dictation.dispose();
  }
});

test("permission, constructor/start and recorder failures release resources without uploading", async () => {
  for (const name of ["NotAllowedError", "NotFoundError"]) {
    const p = browser({
      microphone: async () => {
        throw new DOMException("denied", name);
      },
    });
    await p.dictation.start(p.a, context);
    assert.equal(p.dictation.phase(p.a), "idle");
    assert.match(p.toasts[0], name === "NotAllowedError" ? /Allow microphone/ : /No microphone/);
  }
  for (const startFailure of [false, true]) {
    const p = browser({
      record: () => {
        if (!startFailure) throw new Error("constructor");
        return {
          state: "inactive",
          mimeType: "audio/webm",
          start: () => {
            throw new Error("start");
          },
          stop: () => {},
        };
      },
    });
    const mic = await p.begin();
    assert.equal(mic.live(), false);
    assert.equal(p.timers.size, 0);
    assert.equal(p.dictation.phase(p.a), "idle");
    assert.deepEqual(p.toasts, ["Could not start recording."]);
  }
  const p = browser();
  const mic = await p.begin();
  p.recorders[0].error();
  await settle();
  assert.equal(mic.live(), false);
  assert.equal(p.requests.length, 0);
  assert.equal(p.timers.size, 0);
});

test("actual chunk bytes are bounded, and the time limit commits final audio", async () => {
  const p = browser();
  const mic = await p.begin();
  p.recorders[0].data(new Blob([new Uint8Array(MAX_AUDIO_BYTES)]));
  assert.equal(p.dictation.phase(p.a), "recording", "exact byte boundary is allowed");
  p.recorders[0].data(new Blob(["x"]));
  await settle();
  assert.equal(mic.live(), false);
  assert.equal(p.requests.length, 0);
  assert.match(p.toasts[0], /too long/);
  await p.begin();
  [...p.timers][0]();
  await settle();
  assert.equal(p.requests[0].heard, "final");
  p.requests[0].answer("");
  await settle();
  assert.equal(p.dictation.phase(p.a), "idle");
  assert.ok(p.toasts.includes("No speech was heard."));
});

test("transcription errors preserve existing text and end the busy state", async () => {
  const p = browser();
  p.drafts.setText(A, "keep me");
  await p.begin();
  p.dictation.stop(p.a);
  await settle();
  p.requests[0].reject(new Error("provider unavailable"));
  await settle();
  assert.equal(p.drafts.get(A).text, "keep me");
  assert.equal(p.dictation.phase(p.a), "idle");
  assert.deepEqual(p.toasts, ["failed"]);
});
