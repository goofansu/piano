/// <reference lib="dom" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { jumpEntries } from "../web/src/lib/transcript.ts";

test("jumper retains every Pi assistant turn, including tool-only responses, without separate tool-result destinations", () => {
  const messages = [
    { id: "u1", role: "user", text: "Inspect the files" },
    { id: "a1", role: "assistant", text: "", toolCalls: [{ id: "call", name: "bash", args: "{}" }] },
    { id: "r1", role: "tool_result", text: "files", toolCallId: "call" },
    { id: "a2", role: "assistant", text: "Here are the files" },
    { id: "u2", role: "user", text: "Thanks" },
    { id: "a3", role: "assistant", text: "You're welcome" },
  ] as const;
  const destinations = jumpEntries(messages).filter(entry => "messageId" in entry);
  assert.deepEqual(destinations.map(entry => entry.id), ["u1", "a1", "a2", "u2", "a3"]);
  assert.equal(destinations[1].label, "bash");
});

test("a prompt is reachable before the first assistant response", () => {
  const entries = jumpEntries([{ id: "u1", role: "user", text: "Hello" }]);
  assert.deepEqual(entries.map(entry => entry.kind), ["top", "user", "bottom"]);
});
