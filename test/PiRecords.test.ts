import assert from "node:assert/strict";
import { test } from "node:test";
import { modelChoicesOf } from "../server/PiRecords.ts";

// Expected efforts follow pi-ai getSupportedThinkingLevels: off..high unless mapped to null,
// xhigh and max only when mapped, and off alone for a model that cannot reason.
test("INV-12: Pi's model reply becomes model choices with the efforts Pi accepts and its enabledModels scope", () => {
  const reply = { models: [
    { provider: "anthropic", id: "claude-opus", name: "Opus", reasoning: true, contextWindow: 200_000, cost: { input: 1 }, input: ["text"] },
    { provider: "openai", id: "gpt-5", reasoning: true, contextWindow: 400_000, thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" } },
    { provider: "openai", id: "gpt-5-mini", reasoning: false, contextWindow: 128_000, thinkingLevelMap: { xhigh: "xhigh" } },
    { provider: "local", id: "plain", contextWindow: 8_000 },
  ] };
  assert.deepEqual(modelChoicesOf(reply, ["Anthropic/claude-*", "GPT-5"]), [
    { ref: "anthropic/claude-opus", provider: "anthropic", id: "claude-opus", name: "Opus", reasoning: true, contextWindow: 200_000,
      enabled: true, thinkingLevels: ["off", "minimal", "low", "medium", "high"] },
    { ref: "openai/gpt-5", provider: "openai", id: "gpt-5", name: undefined, reasoning: true, contextWindow: 400_000,
      enabled: true, thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"] },
    { ref: "openai/gpt-5-mini", provider: "openai", id: "gpt-5-mini", name: undefined, reasoning: false, contextWindow: 128_000,
      enabled: false, thinkingLevels: ["off"] },
    { ref: "local/plain", provider: "local", id: "plain", name: undefined, reasoning: false, contextWindow: 8_000,
      enabled: false, thinkingLevels: ["off"] },
  ]);
  assert.ok(modelChoicesOf(reply, [])?.every(m => !m.enabled), "without patterns Pi scopes nothing in");
});

test("a malformed model reply is refused rather than offered as choices", () => {
  for (const reply of [undefined, {}, { models: "none" }, { models: [{ provider: "p", id: "x" }] }]) {
    assert.equal(modelChoicesOf(reply, []), undefined, JSON.stringify(reply));
  }
});
