import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelCatalog, ModelChoice } from "../shared/wire.ts";
import { cacheHit, contextFigures } from "../web/src/lib/contextUsage.ts";

const model = (ref: string, contextWindow: number): ModelChoice => ({
  ref,
  provider: ref.split("/")[0]!,
  id: ref.split("/")[1]!,
  reasoning: false,
  contextWindow,
  enabled: true,
  thinkingLevels: ["off"],
});
const catalog: ModelCatalog = {
  cwd: "/repo",
  models: [model("p/default", 1_000), model("p/big", 200_000)],
  defaultModel: "p/default",
  fetchedAt: "2026-01-01T00:00:00Z",
};

test("before the first reply the selected model's window stands alone, not as —/1k", () => {
  const unknown = contextFigures(undefined, catalog, undefined);
  assert.equal(unknown.label, "1k", "no model chosen falls back to the catalog default");
  assert.equal(unknown.window, 1_000);
  assert.equal(unknown.description, "Context usage unavailable");
  assert.equal(unknown.heading, "Context usage unavailable");
  assert.deepEqual([unknown.used, unknown.left, unknown.low], [null, null, false]);
  assert.equal(contextFigures(undefined, catalog, "p/big").label, "200k");
  assert.equal(contextFigures(undefined, null, undefined).label, "—");
  assert.equal(contextFigures(undefined, null, undefined).window, undefined);
});

test("Pi's figures label the button as percentage used over Pi's window", () => {
  const figures = contextFigures(
    { tokens: 42_000, contextWindow: 200_000, percent: 21 },
    catalog,
    "p/default",
  );
  assert.equal(figures.label, "21%/200k");
  assert.equal(figures.window, 200_000);
  assert.equal(figures.description, "42,000 tokens");
  assert.equal(figures.heading, "Context: 42,000 tokens");
  assert.deepEqual(figures.used, { value: 21, text: "21.0% used" });
  assert.equal(figures.left, "79% left");
  // Tokens without a percentage show the count; a percentage without tokens is not trusted.
  assert.equal(
    contextFigures({ tokens: 2_400, contextWindow: 0, percent: null }, null, undefined).label,
    "2k",
  );
  assert.equal(
    contextFigures({ tokens: null, contextWindow: 200_000, percent: 50 }, null, undefined).used,
    null,
  );
});

test("both surfaces warn below 15% of the window left", () => {
  const at = (percent: number) =>
    contextFigures({ tokens: 1, contextWindow: 100, percent }, null, undefined);
  assert.equal(at(85).low, false, "exactly 15% left is not yet low");
  assert.equal(at(85.5).low, true);
  assert.equal(at(99.5).left, "0.5% left", "under 1% keeps a decimal");
  assert.equal(at(120).left, "0.0% left");
  assert.equal(at(120).used?.value, 100, "the progress bar is clamped");
  assert.equal(at(120).used?.text, "120.0% used");
});

test("cache hit is the cached share of all input, absent without input", () => {
  assert.equal(cacheHit({ input: 10, cacheRead: 30, cacheWrite: 0 }), 75);
  assert.equal(cacheHit({ input: 0, cacheRead: 0, cacheWrite: 0 }), undefined);
  assert.equal(cacheHit(undefined), undefined);
});
