import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelCatalog, ModelChoice, ThinkingLevel } from "../shared/wire.ts";
import {
  emptyChoice,
  type HeldChoice,
  type ModelChange,
  type ModelTarget,
  modelChoice,
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
const fresh: ModelTarget = { kind: "new", cwd: "/repo" };
const hosted: ModelTarget = {
  kind: "session",
  cwd: "/repo",
  sessionId: "s1",
  hosted: true,
  model: "a/quick",
  thinkingLevel: "low",
};
const saved: ModelTarget = { ...hosted, hosted: false, thinkingLevel: "medium" };

/** The picker's shown selection and start options. */
const shown = (held: HeldChoice, c: ModelCatalog | null, target: ModelTarget, ready = true) => {
  const { model, effort, start } = modelChoice(held, c, target, ready);
  return { model, effort, start };
};
const held = (change: ModelChange): HeldChoice => {
  if (change.kind !== "hold") return assert.fail(`expected a hold, got ${change.kind}`);
  return change.held;
};

test("new session: Pi's defaults, then the user's pick, and it starts with what the picker shows", () => {
  const none = emptyChoice(fresh);
  assert.deepEqual(shown(none, catalog, fresh), {
    model: "a/deep",
    effort: "high",
    start: { model: "a/deep", thinkingLevel: "high" },
  });

  const picked = held(modelChoice(none, catalog, fresh).chooseModel("a/quick"));
  assert.deepEqual(picked.pick, { model: "a/quick" });
  // a/quick has no "high": the nearest lower level it accepts.
  assert.deepEqual(shown(picked, catalog, fresh), {
    model: "a/quick",
    effort: "medium",
    start: { model: "a/quick", thinkingLevel: "medium" },
  });
});

test("without Pi defaults: medium effort, every level while the model is unknown", () => {
  const bare: ModelCatalog = {
    ...catalog,
    defaultModel: undefined,
    defaultThinkingLevel: undefined,
  };
  assert.deepEqual(modelChoice(emptyChoice(fresh), bare, fresh).effort, "medium");
  assert.equal(modelChoice(emptyChoice(fresh), bare, fresh).model, undefined);
  const max = held(modelChoice(emptyChoice(fresh), null, fresh).chooseEffort("max"));
  assert.equal(modelChoice(max, null, fresh).effort, "max");
});

test("switching models re-clamps effort and switching back restores the wanted level", () => {
  const xhigh = held(modelChoice(emptyChoice(fresh), catalog, fresh).chooseEffort("xhigh"));
  assert.equal(modelChoice(xhigh, catalog, fresh).effort, "xhigh");
  const plain = held(modelChoice(xhigh, catalog, fresh).chooseModel("a/plain"));
  assert.equal(modelChoice(plain, catalog, fresh).effort, "off");
  const back = held(modelChoice(plain, catalog, fresh).chooseModel("a/deep"));
  assert.deepEqual(shown(back, catalog, fresh).effort, "xhigh");
});

test("hosted session: shows Pi's selection and changes go to Pi, never to the next prompt", () => {
  const choice = modelChoice(emptyChoice(hosted), catalog, hosted);
  assert.deepEqual(shown(emptyChoice(hosted), catalog, hosted), {
    model: "a/quick",
    effort: "low",
    start: {},
  });
  assert.deepEqual(choice.chooseModel("a/deep"), {
    kind: "act",
    action: { _tag: "set_model", model: "a/deep" },
  });
  assert.deepEqual(choice.chooseEffort("minimal"), {
    kind: "act",
    action: { _tag: "set_thinking_level", level: "minimal" },
  });
  // Before Pi reports a selection: its defaults.
  const unreported: ModelTarget = { kind: "session", sessionId: "s1", hosted: true };
  assert.deepEqual(shown(emptyChoice(unreported), catalog, unreported), {
    model: "a/deep",
    effort: "high",
    start: {},
  });
});

test("saved session: shows its recorded selection; only deliberate picks override Pi's restore", () => {
  const none = emptyChoice(saved);
  assert.deepEqual(shown(none, catalog, saved), {
    model: "a/quick",
    effort: "medium",
    start: {},
  });

  const low = held(modelChoice(none, catalog, saved).chooseEffort("low"));
  assert.deepEqual(low.pick, { thinkingLevel: "low" });
  assert.deepEqual(shown(low, catalog, saved), {
    model: "a/quick",
    effort: "low",
    start: { thinkingLevel: "low" },
  });

  const both = held(modelChoice(low, catalog, saved).chooseModel("a/plain"));
  assert.deepEqual(shown(both, catalog, saved), {
    model: "a/plain",
    effort: "off",
    start: { model: "a/plain", thinkingLevel: "off" },
  });
});

test("reconnect: a pick survives a refreshed catalog that still lists its model", () => {
  const pick = held(modelChoice(emptyChoice(fresh), catalog, fresh).chooseModel("a/quick"));
  const both = held(modelChoice(pick, catalog, fresh).chooseEffort("low"));
  const refreshed: ModelCatalog = { ...catalog, fetchedAt: "t2" };
  assert.equal(shown(both, refreshed, fresh).model, "a/quick");
  assert.equal(shown(both, refreshed, fresh).effort, "low");
  // While the catalog reloads, the pick still stands.
  assert.equal(shown(both, null, fresh).model, "a/quick");
  assert.equal(shown(both, null, fresh).effort, "low");
});

test("reconnect: a picked model that left the catalog falls back to the default, effort re-clamped", () => {
  const quick = held(modelChoice(emptyChoice(fresh), catalog, fresh).chooseModel("a/quick"));
  const xhigh = held(modelChoice(quick, catalog, fresh).chooseEffort("xhigh"));
  const shrunk: ModelCatalog = {
    ...catalog,
    fetchedAt: "t2",
    defaultModel: "a/plain",
    models: [catalog.models[0], catalog.models[2]],
  };
  assert.deepEqual(shown(xhigh, shrunk, fresh), {
    model: "a/plain",
    effort: "off",
    start: { model: "a/plain", thinkingLevel: "off" },
  });
  // A saved session no longer overrides with the vanished model; Pi restores its own.
  const savedQuick = held(modelChoice(emptyChoice(saved), catalog, saved).chooseModel("a/quick"));
  assert.equal(shown(savedQuick, shrunk, saved).start.model, undefined);
});

test("offline: a pick made while disconnected survives reconnect and travels with the next prompt", () => {
  // Disconnected, the hosted session's change is held rather than sent as a set_model.
  const offline = held(
    modelChoice(emptyChoice(hosted), catalog, hosted, false).chooseModel("a/deep"),
  );
  assert.deepEqual(shown(offline, catalog, hosted, false), {
    model: "a/deep",
    effort: "low",
    start: { model: "a/deep" },
  });
  // Reconnected: still the pick, still carried in the prompt, and further changes are held too.
  const online = modelChoice(offline, catalog, hosted, true);
  assert.deepEqual(
    { model: online.model, effort: online.effort, start: online.start },
    { model: "a/deep", effort: "low", start: { model: "a/deep" } },
  );
  const both = held(online.chooseEffort("minimal"));
  assert.deepEqual(modelChoice(both, catalog, hosted).start, {
    model: "a/deep",
    thinkingLevel: "minimal",
  });
  // Once the prompt carried it, Pi's selection shows again and changes go to Pi.
  const after = modelChoice(online.submitted, catalog, hosted);
  assert.deepEqual([after.model, after.effort, after.start], ["a/quick", "low", {}]);
  assert.equal(after.chooseModel("a/deep").kind, "act");
});

test("scope: a pick belongs to its session, hosting state, or New-page directory", () => {
  const sessionPick = held(modelChoice(emptyChoice(saved), catalog, saved).chooseModel("a/plain"));
  assert.equal(modelChoice(sessionPick, catalog, saved).model, "a/plain");
  // Switching session drops it.
  const other: ModelTarget = { ...saved, sessionId: "s2" };
  assert.equal(modelChoice(sessionPick, catalog, other).model, "a/quick");
  assert.deepEqual(modelChoice(sessionPick, catalog, other).start, {});
  // Hosting starting is a new scope: Pi's selection shows and changes go to it.
  assert.equal(modelChoice(sessionPick, catalog, hosted).model, "a/quick");
  assert.equal(modelChoice(sessionPick, catalog, hosted).chooseModel("a/deep").kind, "act");
  // The New page's pick belongs to its directory.
  const newPick = held(modelChoice(emptyChoice(fresh), catalog, fresh).chooseModel("a/plain"));
  assert.equal(modelChoice(newPick, catalog, fresh).model, "a/plain");
  const elsewhere: ModelTarget = { kind: "new", cwd: "/other" };
  assert.deepEqual(modelChoice(newPick, catalog, elsewhere).start, {
    model: "a/deep",
    thinkingLevel: "high",
  });
});
