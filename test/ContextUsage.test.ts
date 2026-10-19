import assert from "node:assert/strict";
import { test } from "node:test";
import { RunLedger } from "../server/Subagents.ts";
import type { ModelCatalog, ModelChoice, RenderMsg } from "../shared/wire.ts";
import {
  cacheHit,
  contextFigures,
  responseHistory,
  subagentRows,
  usageBreakdown,
} from "../web/src/lib/contextUsage.ts";

const model = (ref: string, contextWindow: number): ModelChoice => ({
  ref,
  provider: ref.split("/")[0]!,
  id: ref.split("/")[1]!,
  reasoning: false,
  contextWindow,
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

const usage = (totalTokens: number, cost: number) => ({
  input: totalTokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens,
  cost,
});
const transcript: RenderMsg[] = [
  { id: "u1", role: "user", text: "hi" },
  { id: "a1", role: "assistant", text: "", usage: usage(1_200, 0.05) },
  { id: "t1", role: "tool_result", text: "", usage: usage(9_999_999, 9) },
  { id: "a2", role: "assistant", text: "" },
  { id: "a3", role: "assistant", text: "", usage: usage(12_345, 0.0123) },
  { id: "a4", role: "assistant", text: "", usage: usage(800, 0.004) },
];

test("history inspects the chosen response, else the latest, by its place among responses with usage", () => {
  const latest = responseHistory(transcript, "tokens", undefined);
  assert.deepEqual(
    latest.responses.map((message) => message.id),
    ["a1", "a3", "a4"],
    "only assistant responses that carry usage",
  );
  assert.deepEqual(latest.values, [1_200, 12_345, 800]);
  assert.deepEqual([latest.selected?.id, latest.position], ["a4", 3]);
  assert.equal(latest.peakText, "12k");
  const chosen = responseHistory(transcript, "tokens", "a3");
  assert.deepEqual([chosen.selected?.id, chosen.position], ["a3", 2]);
  const gone = responseHistory(transcript, "tokens", "a2");
  assert.deepEqual([gone.selected?.id, gone.position], ["a4", 3], "no usage falls back to latest");
  const empty = responseHistory([], "tokens", undefined);
  assert.deepEqual([empty.selected, empty.position, empty.peak], [undefined, 0, 0]);
});

test("the cost metric graphs each response's cost and captions the peak in dollars", () => {
  const cost = responseHistory(transcript, "cost", undefined);
  assert.deepEqual(cost.values, [0.05, 0.0123, 0.004]);
  assert.equal(cost.peak, 0.05);
  assert.equal(cost.peakText, "$0.0500");
});

test("the breakdown formats each figure and shows — where one is unknown", () => {
  const totals = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 };
  assert.deepEqual(usageBreakdown(undefined, { tokens: totals, cost: 0.5 }), [
    { label: "Input", response: "—", session: "100" },
    { label: "Output", response: "—", session: "20" },
    { label: "Cache read", response: "—", session: "0" },
    { label: "Cache write", response: "—", session: "0" },
    { label: "Cache hit", response: "—", session: "0%" },
    // The Session column stays Pi's main-session figure, without subagents.
    { label: "Total tokens", response: "—", session: "120" },
    { label: "Cost", response: "—", session: "$0.5000" },
  ]);
  const response = {
    input: 10,
    output: 2_500,
    cacheRead: 30,
    cacheWrite: 0,
    totalTokens: 2_540,
    cost: 0.12345,
  };
  assert.deepEqual(usageBreakdown(response, undefined), [
    { label: "Input", response: "10", session: "—" },
    { label: "Output", response: "2,500", session: "—" },
    { label: "Cache read", response: "30", session: "—" },
    { label: "Cache write", response: "0", session: "—" },
    { label: "Cache hit", response: "75%", session: "—" },
    { label: "Total tokens", response: "2,540", session: "—" },
    { label: "Cost", response: "$0.1235", session: "—" },
  ]);
});

// The server folds deliveries into `subagents`; the table shows what it is given.
const subagents = (deliveries: unknown[]) => subagentRows(new RunLedger().add(deliveries).usage);
const result = (
  runId: string,
  profile: string,
  usage: Record<string, number> | undefined,
  model?: string,
) => ({
  type: "custom_message",
  id: runId + profile,
  customType: "subagent-notification",
  content: "",
  details: {
    runId,
    subagentId: `subagent-${runId}`,
    agent: profile,
    label: profile,
    status: "completed",
    durationMillis: 1,
    ...(usage ? { usage } : {}),
    ...(model ? { model } : {}),
  },
});

test("subagent rows list each Profile that spent anything, by model ID, then all subagents", () => {
  const table = subagents([
    result(
      "run-qbdd-1",
      "usage-probe-pi",
      { input: 3518, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0.007096 },
      "openai/gpt-6.1-sol",
    ),
    result(
      "run-qbdd-2",
      "usage-probe-claude",
      { input: 10, output: 106, cacheRead: 0, cacheWrite: 20786, cost: 0.042112 },
      "claude-haiku-4-5-20251001",
    ),
    result("run-idle", "usage-probe-idle", {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    }),
    result(
      "run-mixed-1",
      "mixed",
      { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      "one",
    ),
    result(
      "run-mixed-2",
      "mixed",
      { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      "two",
    ),
  ]);
  assert.deepEqual(table, {
    rows: [
      {
        profile: "usage-probe-pi",
        model: "gpt-6.1-sol",
        modelRef: "openai/gpt-6.1-sol",
        tokens: "3,524",
        cost: "$0.0071",
      },
      {
        profile: "usage-probe-claude",
        model: "claude-haiku-4-5-20251001",
        modelRef: "claude-haiku-4-5-20251001",
        tokens: "20,902",
        cost: "$0.0421",
      },
      // Runs that named different models show no model.
      { profile: "mixed", tokens: "2", cost: "$0.0000" },
    ],
    // The idle Run's Profile has no row, but the total still counts every Run.
    total: { tokens: "24,428", cost: "$0.0492" },
  });
});

test("the subagents table is hidden without usage or when every Run spent nothing", () => {
  assert.equal(subagentRows(undefined), null);
  assert.equal(subagents([result("r1", "a", undefined)]), null);
  assert.equal(
    subagents([result("r1", "a", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })]),
    null,
  );
});
