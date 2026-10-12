import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelCatalog, ModelChoice, ThinkingLevel } from "../shared/wire.ts";
import {
  type ModelTarget,
  pickEffort,
  pickModel,
  selectModel,
  startOptions,
} from "../web/src/lib/modelChoice.ts";

const model = (ref: string, thinkingLevels: ThinkingLevel[]): ModelChoice => {
  const [provider, id] = ref.split("/");
  return {
    ref,
    provider,
    id,
    reasoning: thinkingLevels.length > 1,
    contextWindow: 200000,
    enabled: true,
    thinkingLevels,
  };
};
const catalog: ModelCatalog = {
  cwd: "/repo",
  fetchedAt: "t1",
  defaultModel: "a/deep",
  defaultThinkingLevel: "high",
  models: [
    model("a/deep", ["off", "minimal", "low", "medium", "high", "xhigh"]),
    model("a/quick", ["off", "low", "medium"]),
    model("a/plain", ["off"]),
  ],
};
const fresh: ModelTarget = { kind: "new" };
const hosted: ModelTarget = {
  kind: "session",
  hosted: true,
  model: "a/quick",
  thinkingLevel: "low",
};
const saved: ModelTarget = {
  kind: "session",
  hosted: false,
  model: "a/quick",
  thinkingLevel: "medium",
};

test("new session: Pi's defaults, then the user's pick, and it starts with what the picker shows", () => {
  assert.deepEqual(selectModel(catalog, fresh, {}), { model: "a/deep", effort: "high" });
  assert.deepEqual(startOptions(catalog, fresh, {}), { model: "a/deep", thinkingLevel: "high" });

  const change = pickModel(fresh, {}, "a/quick");
  assert.deepEqual(change, { kind: "pick", pick: { model: "a/quick" } });
  if (change.kind !== "pick") return assert.fail("expected a pick");
  // a/quick has no "high": the nearest lower level it accepts.
  assert.deepEqual(selectModel(catalog, fresh, change.pick), {
    model: "a/quick",
    effort: "medium",
  });
  assert.deepEqual(startOptions(catalog, fresh, change.pick), {
    model: "a/quick",
    thinkingLevel: "medium",
  });
});

test("without Pi defaults: medium effort, every level while the model is unknown", () => {
  const bare: ModelCatalog = {
    ...catalog,
    defaultModel: undefined,
    defaultThinkingLevel: undefined,
  };
  assert.deepEqual(selectModel(bare, fresh, {}), { model: undefined, effort: "medium" });
  assert.deepEqual(selectModel(null, fresh, { thinkingLevel: "max" }), {
    model: undefined,
    effort: "max",
  });
});

test("switching models re-clamps effort and switching back restores the wanted level", () => {
  const effort = pickEffort(fresh, {}, "xhigh");
  if (effort.kind !== "pick") return assert.fail("expected a pick");
  assert.deepEqual(selectModel(catalog, fresh, effort.pick), { model: "a/deep", effort: "xhigh" });
  const toPlain = pickModel(fresh, effort.pick, "a/plain");
  if (toPlain.kind !== "pick") return assert.fail("expected a pick");
  assert.deepEqual(selectModel(catalog, fresh, toPlain.pick), { model: "a/plain", effort: "off" });
  const back = pickModel(fresh, toPlain.pick, "a/deep");
  if (back.kind !== "pick") return assert.fail("expected a pick");
  assert.deepEqual(selectModel(catalog, fresh, back.pick), { model: "a/deep", effort: "xhigh" });
});

test("hosted session: shows Pi's selection and changes go to Pi, never to the first prompt", () => {
  assert.deepEqual(selectModel(catalog, hosted, { model: "a/deep", thinkingLevel: "high" }), {
    model: "a/quick",
    effort: "low",
  });
  assert.deepEqual(pickModel(hosted, {}, "a/deep"), {
    kind: "act",
    action: { _tag: "set_model", model: "a/deep" },
  });
  assert.deepEqual(pickEffort(hosted, {}, "minimal"), {
    kind: "act",
    action: { _tag: "set_thinking_level", level: "minimal" },
  });
  assert.deepEqual(startOptions(catalog, hosted, { model: "a/deep" }), {});
  // Before Pi reports a selection: its defaults.
  assert.deepEqual(selectModel(catalog, { kind: "session", hosted: true }, {}), {
    model: "a/deep",
    effort: "high",
  });
});

test("saved session: shows its recorded selection; only deliberate picks override Pi's restore", () => {
  assert.deepEqual(selectModel(catalog, saved, {}), { model: "a/quick", effort: "medium" });
  assert.deepEqual(startOptions(catalog, saved, {}), {});

  const effort = pickEffort(saved, {}, "low");
  assert.deepEqual(effort, { kind: "pick", pick: { thinkingLevel: "low" } });
  if (effort.kind !== "pick") return assert.fail("expected a pick");
  assert.deepEqual(selectModel(catalog, saved, effort.pick), { model: "a/quick", effort: "low" });
  assert.deepEqual(startOptions(catalog, saved, effort.pick), { thinkingLevel: "low" });

  const both = pickModel(saved, effort.pick, "a/plain");
  if (both.kind !== "pick") return assert.fail("expected a pick");
  assert.deepEqual(selectModel(catalog, saved, both.pick), { model: "a/plain", effort: "off" });
  assert.deepEqual(startOptions(catalog, saved, both.pick), {
    model: "a/plain",
    thinkingLevel: "off",
  });
});

test("reconnect: a pick survives a refreshed catalog that still lists its model", () => {
  const pick = { model: "a/quick", thinkingLevel: "low" as const };
  const refreshed: ModelCatalog = { ...catalog, fetchedAt: "t2" };
  assert.deepEqual(selectModel(refreshed, fresh, pick), { model: "a/quick", effort: "low" });
  // While the catalog reloads, the pick still stands.
  assert.deepEqual(selectModel(null, fresh, pick), { model: "a/quick", effort: "low" });
});

test("reconnect: a picked model that left the catalog falls back to the default, effort re-clamped", () => {
  const pick = { model: "a/quick", thinkingLevel: "xhigh" as const };
  const shrunk: ModelCatalog = {
    ...catalog,
    fetchedAt: "t2",
    defaultModel: "a/plain",
    models: [catalog.models[0], catalog.models[2]],
  };
  assert.deepEqual(selectModel(shrunk, fresh, pick), { model: "a/plain", effort: "off" });
  assert.deepEqual(startOptions(shrunk, fresh, pick), { model: "a/plain", thinkingLevel: "off" });
  // A saved session no longer overrides with the vanished model; Pi restores its own.
  assert.equal(startOptions(shrunk, saved, pick).model, undefined);
});
