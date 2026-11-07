import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { VoiceHints } from "../shared/voiceInput.ts";
import type { RenderMsg } from "../shared/wire.ts";
import { insertDictation, recordingType, voiceHints } from "../web/src/lib/voiceInput.ts";

const message = (id: string, role: RenderMsg["role"], text: string): RenderMsg => ({
  id,
  role,
  text,
});

test("hints carry the session's names, its latest messages and the files it wrote", () => {
  const messages: RenderMsg[] = [
    message("1", "user", "first question"),
    message("2", "assistant", "first answer"),
    message("3", "user", "second question"),
    {
      ...message("4", "assistant", ""),
      toolCalls: [{ id: "call-1", name: "write", args: "{}", writtenPath: "src/Voice.ts" }],
    },
    { ...message("5", "tool_result", "ok"), toolCallId: "call-1", toolName: "write" },
    message("6", "assistant", "I wrote `Voice.ts`."),
    message("7", "user", "  "),
  ];
  const hints = voiceHints(
    {
      project: "Piano",
      folder: "piano",
      branch: "feat/voice-input",
      title: "Voice",
      messages,
      commands: ["verify-piano"],
    },
    "Now rename",
  );
  assert.deepEqual(hints, {
    project: "Piano",
    folder: "piano",
    branch: "feat/voice-input",
    session: "Voice",
    draft: "Now rename",
    // The four newest messages with words, oldest first: tool output and blank drafts are not speech context.
    recent: ["first question", "first answer", "second question", "I wrote `Voice.ts`."],
    files: ["src/Voice.ts"],
    commands: ["verify-piano"],
  });
  assert.ok(Schema.is(VoiceHints)(hints));
});

test("long sessions stay inside what the server accepts", () => {
  const long = "word ".repeat(5000);
  const messages = Array.from({ length: 30 }, (_, i) =>
    message(String(i), i % 2 ? "assistant" : "user", `${long} end ${i}`),
  );
  const hints = voiceHints(
    {
      messages,
      folder: "f".repeat(2000),
      commands: Array.from({ length: 900 }, (_, i) => `command-${i}`),
    },
    long,
  );
  assert.ok(Schema.is(VoiceHints)(hints), "hints decode on the server");
  assert.equal(hints.recent?.length, 4);
  // A long reply keeps its end, which is what the speaker answers.
  assert.ok(hints.recent?.at(-1)?.endsWith("end 29"));
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
