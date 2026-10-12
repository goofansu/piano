import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelCatalog, ModelChoice } from "../shared/wire.ts";
import {
  type ModelPickerInput,
  modelPickerEnabled,
  modelPickerView,
} from "../web/src/lib/modelPicker.ts";

const model = (ref: string, name?: string): ModelChoice => {
  const [provider, id] = ref.split("/");
  return {
    ref,
    provider,
    id,
    ...(name ? { name } : {}),
    reasoning: true,
    contextWindow: 200000,
    enabled: true,
    thinkingLevels: ["off", "low", "medium", "high"],
  };
};

const catalog = (over: Partial<ModelCatalog> = {}): ModelCatalog => ({
  cwd: "/repo",
  models: [model("anthropic/claude-x", "Claude X"), model("openai/gpt-y", "GPT Y")],
  defaultModel: "anthropic/claude-x",
  defaultThinkingLevel: "medium",
  fetchedAt: "2026-10-12T00:00:00Z",
  ...over,
});

const base: ModelPickerInput = {
  catalog: catalog(),
  value: undefined,
  effort: "medium",
  query: "",
  disabled: false,
  canRefresh: false,
  noDirectory: false,
  chosen: null,
  saving: false,
};
const view = (over: Partial<ModelPickerInput> = {}) => modelPickerView({ ...base, ...over });

test("Mod+/ and the trigger open the picker only with a model to pick or a refresh to find one, never while disabled", () => {
  const empty = catalog({ models: [] });
  const cases: [string, Partial<ModelPickerInput>, boolean][] = [
    ["a model to pick", { canRefresh: false }, true],
    ["no models but a refresh", { catalog: empty, canRefresh: true }, true],
    ["no models and no refresh", { catalog: empty, canRefresh: false }, false],
    ["catalog still loading", { catalog: null, canRefresh: true }, false],
    ["editor disabled", { disabled: true, canRefresh: true }, false],
  ];
  for (const [why, over, open] of cases) {
    const input = { ...base, ...over };
    assert.equal(modelPickerEnabled(input), open, `shortcut: ${why}`);
    assert.equal(modelPickerView(input).triggerEnabled, open, `trigger: ${why}`);
  }
});

test("the trigger names the shown model, or why there is none", () => {
  assert.equal(view({ catalog: null, noDirectory: true }).label, "Model");
  assert.equal(view({ catalog: null, noDirectory: true }).shimmer, false);
  assert.equal(view({ catalog: null }).label, "Loading models");
  assert.equal(view({ catalog: null }).shimmer, true);
  assert.equal(
    view({ catalog: catalog({ models: [], error: "pi exited" }), value: "openai/gpt-y" }).label,
    "No models",
    "a catalog error wins over a recorded model",
  );
  assert.equal(view({ value: "openai/gpt-y" }).label, "gpt-y");
  assert.equal(view({ value: "openrouter/meta/llama" }).label, "llama");
  const defaulted = view();
  assert.equal(defaulted.shown, "anthropic/claude-x", "Pi's default model stands in");
  assert.equal(defaulted.label, "claude-x");
  assert.equal(view({ catalog: catalog({ defaultModel: undefined }) }).label, "Model");
  assert.equal(view().shimmer, false);
});

test("search matches provider, id or name literally and keeps catalog order", () => {
  const refs = (query: string) => view({ query }).visibleModels.map((m) => m.ref);
  assert.deepEqual(refs(""), ["anthropic/claude-x", "openai/gpt-y"]);
  assert.deepEqual(refs("OPENAI"), ["openai/gpt-y"], "provider, case-insensitive");
  assert.deepEqual(refs(" claude-x "), ["anthropic/claude-x"], "id, trimmed");
  assert.deepEqual(refs("gpt y"), ["openai/gpt-y"], "display name");
  assert.deepEqual(refs("-"), ["anthropic/claude-x", "openai/gpt-y"]);
  assert.deepEqual(refs("cly"), [], "not fuzzy");
  assert.equal(view({ query: "zzz" }).emptyText, "No model matches.");
  assert.equal(
    view({ catalog: catalog({ models: [], error: "pi exited" }) }).emptyText,
    "No models available.",
  );
});

test("the shown selection is the default only when both model and effort match Pi's", () => {
  const same = view({ value: "anthropic/claude-x", effort: "medium" });
  assert.equal(same.isDefault, true);
  assert.equal(same.saveLabel, "Default for new sessions");
  assert.equal(same.canSaveDefault, false, "nothing to save");
  for (const over of [
    { value: "openai/gpt-y", effort: "medium" },
    { value: "anthropic/claude-x", effort: "high" },
  ] satisfies Partial<ModelPickerInput>[]) {
    const v = view(over);
    assert.equal(v.isDefault, false, JSON.stringify(over));
    assert.equal(v.saveLabel, "Use for new sessions");
    assert.equal(v.canSaveDefault, true);
  }
  assert.equal(
    view({ catalog: catalog({ defaultModel: undefined }) }).isDefault,
    false,
    "no model shown",
  );
});

test("saving defaults waits for a model, a working catalog and the previous save", () => {
  const changed = { value: "openai/gpt-y" };
  assert.equal(view(changed).canSaveDefault, true);
  const blocked: [string, Partial<ModelPickerInput>][] = [
    ["catalog error", { catalog: catalog({ error: "pi exited" }) }],
    ["waiting for the chosen model", { chosen: "anthropic/claude-x" }],
    ["save in flight", { saving: true }],
    ["picker disabled", { disabled: true }],
    ["no model shown", { value: undefined, catalog: catalog({ defaultModel: undefined }) }],
  ];
  for (const [why, over] of blocked)
    assert.equal(view({ ...changed, ...over }).canSaveDefault, false, why);
  assert.equal(
    view({ ...changed, chosen: "openai/gpt-y" }).canSaveDefault,
    true,
    "the chosen model has arrived",
  );
});

test("efforts follow the shown model and pause while a chosen model is on its way", () => {
  const narrow = catalog({
    models: [{ ...model("anthropic/claude-x"), thinkingLevels: ["off"] }],
  });
  assert.deepEqual(view({ catalog: narrow }).levels, ["off"]);
  assert.equal(view({ chosen: "openai/gpt-y" }).effortEnabled, false);
  assert.equal(view({ value: "openai/gpt-y", chosen: "openai/gpt-y" }).effortEnabled, true);
  assert.equal(view({ disabled: true }).effortEnabled, false);
});
