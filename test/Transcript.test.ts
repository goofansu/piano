/// <reference lib="dom" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { jumpEntries } from "../web/src/lib/transcript.ts";

test("jumper numbers Pi assistant turns, including tool-only responses, not prompts or tool results", () => {
  const messages = [
    { id: "u1", role: "user", text: "Inspect the files" },
    { id: "a1", role: "assistant", text: "", toolCalls: [{ id: "call", name: "bash", args: "{}" }] },
    { id: "r1", role: "tool_result", text: "files", toolCallId: "call" },
    { id: "a2", role: "assistant", text: "Here are the files" },
    { id: "u2", role: "user", text: "Thanks" },
    { id: "a3", role: "assistant", text: "You're welcome" },
  ] as const;
  const destinations = jumpEntries(messages).filter(entry => "messageId" in entry);
  assert.deepEqual(destinations.map(entry => [entry.id, entry.turn]), [
    ["u1", 1], ["a1", 1], ["a2", 2], ["u2", 3], ["a3", 3],
  ]);
  assert.equal(destinations[1].label, "bash");
});

test("a prompt without an assistant response does not invent a Pi turn", () => {
  const entries = jumpEntries([{ id: "u1", role: "user", text: "Hello" }]);
  const prompt = entries.find(entry => entry.kind === "user");
  assert.ok(prompt && "turn" in prompt);
  assert.equal(prompt.turn, undefined);
});
