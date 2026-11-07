import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { MAX_HINT_LENGTH, VoiceHints } from "../shared/voiceInput.ts";
import { insertDictation, recordingType, voiceHints } from "../web/src/lib/voiceInput.ts";

test("hints carry the names of where a message is dictated", () => {
  const hints = voiceHints({
    project: " Piano ",
    folder: "piano",
    branch: "feat/voice-input",
    session: " Voice",
  });
  assert.deepEqual(hints, {
    project: "Piano",
    folder: "piano",
    branch: "feat/voice-input",
    session: "Voice",
  });
  assert.ok(Schema.is(VoiceHints)(hints));
  // A blank name is left out rather than sent empty.
  assert.deepEqual(voiceHints({ folder: "piano", branch: "  " }), { folder: "piano" });
});

test("long names stay inside what the server accepts", () => {
  const long = "f".repeat(MAX_HINT_LENGTH + 1);
  const hints = voiceHints({ folder: long, session: "t".repeat(MAX_HINT_LENGTH * 4) });
  assert.ok(Schema.is(VoiceHints)(hints), "hints decode on the server");
  // A name longer than the limit is clipped to it, not dropped.
  assert.equal(hints.folder, long.slice(0, MAX_HINT_LENGTH));
  assert.equal(hints.session?.length, MAX_HINT_LENGTH);
});

test("a transcript lands at the cursor, a space apart from the words beside it", () => {
  assert.deepEqual(insertDictation("", { start: 0, end: 0 }, " Hello there. "), {
    text: "Hello there.",
    caret: 12,
  });
  assert.deepEqual(insertDictation("Rename it", { start: 9, end: 9 }, "to foo."), {
    text: "Rename it to foo.",
    caret: 17,
  });
  assert.deepEqual(insertDictation("Fix  later", { start: 4, end: 4 }, "the test"), {
    text: "Fix the test later",
    caret: 12,
  });
  // A selection is replaced.
  assert.deepEqual(insertDictation("Use OLD here", { start: 4, end: 7 }, "useDraftEditor"), {
    text: "Use useDraftEditor here",
    caret: 18,
  });
  // Punctuation joins the word before it; an empty transcript changes nothing.
  assert.equal(insertDictation("Done", { start: 4, end: 4 }, ", thanks").text, "Done, thanks");
  assert.deepEqual(insertDictation("Keep", { start: 2, end: 2 }, "   "), {
    text: "Keep",
    caret: 2,
  });
});

test("recording picks a format OpenAI reads, in the browser's order of support", () => {
  assert.equal(
    recordingType((t) => t === "audio/mp4"),
    "audio/mp4",
  );
  assert.equal(
    recordingType((t) => t.startsWith("audio/webm")),
    "audio/webm;codecs=opus",
  );
  assert.equal(
    recordingType(() => false),
    undefined,
  );
});
