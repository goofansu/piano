/// <reference lib="dom" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { jumpEntries } from "../web/src/lib/transcript.ts";

test("jumper previews prompts and final replies, not tool-only or intermediate assistant turns", () => {
  const messages = [
    { id: "u1", role: "user", text: "Inspect the files" },
    { id: "a1", role: "assistant", text: "", toolCalls: [{ id: "call", name: "bash", args: "{}" }] },
    { id: "r1", role: "tool_result", text: "files", toolCallId: "call" },
    { id: "intermediate", role: "assistant", text: "Inspecting the files now" },
    { id: "a2", role: "assistant", text: "Here are the files" },
    { id: "u2", role: "user", text: "Thanks" },
    { id: "a3", role: "assistant", text: "You're welcome" },
  ] as const;
  const destinations = jumpEntries(messages).filter(entry => "messageId" in entry);
  assert.deepEqual(destinations.map(entry => entry.id), ["u1", "a2", "u2", "a3"]);
  assert.equal(destinations[1].label, "Here are the files");
});

test("a prompt is reachable before the first assistant response", () => {
  const entries = jumpEntries([{ id: "u1", role: "user", text: "Hello" }]);
  assert.deepEqual(entries.map(entry => entry.kind), ["top", "user", "bottom"]);
});

test("a skill prompt is listed as the command that was typed, never as Pi's expansion markup", () => {
  const skill = { name: "research", location: "/home/me/.pi/agent/skills/research/SKILL.md", body: "# Research\n\nLook things up." };
  const entries = jumpEntries([
    { id: "u1", role: "user", text: "the changelog", skill },
    { id: "u2", role: "user", text: "", skill },
  ]);
  assert.deepEqual(entries.filter(entry => entry.kind === "user").map(entry => entry.label), ["/skill:research the changelog", "/skill:research"]);
});
