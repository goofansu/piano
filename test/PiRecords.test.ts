import assert from "node:assert/strict";
import { test } from "node:test";
import { modelChoicesOf, piCommandFor } from "../server/PiRecords.ts";

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

test("INV-12: a model ref that is not provider/id is refused before reaching Pi", () => {
  for (const model of ["gpt-5", "/gpt-5", ""]) {
    assert.deepEqual(piCommandFor({ _tag: "set_model", model }), { rejected: `Model must be provider/id, got "${model}"` });
  }
  // Only the first slash separates the provider; Pi's model IDs may contain more.
  assert.deepEqual(piCommandFor({ _tag: "set_model", model: "openrouter/openai/gpt-5" }),
    { command: { type: "set_model", provider: "openrouter", modelId: "openai/gpt-5" } });
});

test("INV-03: text input carries its streaming behaviour; input with images carries none", () => {
  const png = { kind: "image" as const, name: "dot.png", mimeType: "image/png" as const,
    data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).toString("base64") };
  assert.deepEqual(piCommandFor({ _tag: "steer", text: "now" }), { command: { type: "prompt", message: "now", streamingBehavior: "steer" } });
  assert.deepEqual(piCommandFor({ _tag: "prompt", text: "later" }), { command: { type: "prompt", message: "later", streamingBehavior: "followUp" } });
  assert.deepEqual(piCommandFor({ _tag: "steer", text: "look", attachments: [png] }),
    { command: { type: "prompt", message: "look", images: [{ type: "image", data: png.data, mimeType: "image/png" }] } });
  assert.ok("rejected" in piCommandFor({ _tag: "steer", text: "look", attachments: [{ ...png, mimeType: "image/jpeg" }] }), "bytes must match the declared type");
});

test("INV-04: a dialog answer reaches Pi as its original value, and cancel as a cancellation", () => {
  const dialog = { id: "d1", generation: "g", receivedAt: 0, deadlineAt: 1, deadlineKind: "host-recovery" as const,
    method: "select" as const, options: ["Use sk-alpha111", "Use sk-beta2222", "Use token=abc12345"] };
  const answer = (value: string, cancelled?: boolean) => piCommandFor({ _tag: "answer", id: "d1", generation: "g", value, cancelled }, dialog);
  // The browser saw only redacted labels; a unique one still selects the original option.
  assert.deepEqual(answer("Use token=[REDACTED]"), { command: { type: "extension_ui_response", id: "d1", value: "Use token=abc12345" } });
  // Two options share "Use [REDACTED]": refuse instead of guessing.
  assert.deepEqual(answer("Use [REDACTED]"), { rejected: "This option is unavailable or ambiguous after redaction. Cancel the dialog instead." });
  assert.deepEqual(answer("Use [REDACTED]", true), { command: { type: "extension_ui_response", id: "d1", cancelled: true } });
  assert.deepEqual(piCommandFor({ _tag: "answer", id: "d1", generation: "g", confirmed: false }, { ...dialog, method: "confirm", options: undefined }),
    { command: { type: "extension_ui_response", id: "d1", confirmed: false } });
});
