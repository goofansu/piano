import assert from "node:assert/strict";
import { test } from "node:test";
import { RunLedger } from "../server/Subagents.ts";
import type { RunUsage } from "../shared/wire.ts";

// Raw Pi session entries as `get_entries` returns them; the ledger reads only these.
let next = 0;
const entry = (fields: Record<string, unknown>) => ({ id: `e${++next}`, ...fields });
const spend = (input: number, cost: number, rest: Partial<RunUsage> = {}): RunUsage => ({
  input,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost,
  ...rest,
});
type Run = { runId: string; agent: string; usage?: RunUsage; model?: string };
const extras = ({ usage, model }: Run) => ({
  ...(usage ? { usage } : {}),
  ...(model ? { model } : {}),
});
const toolResult = (toolName: string, details: unknown) =>
  entry({
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: `call-${next}`,
      toolName,
      content: [{ type: "text", text: "OK" }],
      details,
      isError: false,
    },
  });
const notified = (run: Run) =>
  entry({
    type: "custom_message",
    customType: "subagent-notification",
    content: "Result",
    display: true,
    details: {
      runId: run.runId,
      subagentId: `sub-${run.runId}`,
      agent: run.agent,
      label: "probe",
      status: "completed",
      durationMillis: 10,
      ...extras(run),
    },
  });
const fetched = (run: Run) =>
  toolResult("agent_result", {
    kind: "result",
    rowPhrase: "2 characters",
    tone: "toolOutput",
    outcome: "available",
    run: { runId: run.runId, agent: run.agent, status: "completed", ...extras(run) },
  });
const waited = (...runs: Run[]) =>
  toolResult("agent_wait", {
    kind: "collection",
    scope: "named",
    runs: runs.map((run) => ({
      runId: run.runId,
      agent: run.agent,
      status: "completed",
      ...extras(run),
    })),
    stillRunning: 0,
    unknown: 0,
    unavailable: 0,
    noActiveRuns: false,
  });
const said = (text: string) =>
  entry({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
const rows = (ledger: RunLedger) =>
  ledger.usage?.profiles.map((p) => [p.profile, p.totalTokens, p.cost, p.runs]);

test("absent usage folds to nothing, unlike Runs that spent nothing", () => {
  const ledger = new RunLedger().add([
    notified({ runId: "r1", agent: "a" }),
    fetched({ runId: "r2", agent: "b" }),
    waited({ runId: "r3", agent: "c" }),
    said("unrelated"),
  ]);
  assert.equal(ledger.usage, undefined);
  ledger.add([waited({ runId: "r1", agent: "a", usage: spend(0, 0) })]);
  assert.deepEqual(rows(ledger), [["a", 0, 0, 1]]);
});

test("a Run delivered on every channel across batches counts once, the last usage-bearing delivery winning", () => {
  const ledger = new RunLedger();
  ledger.add([said("start"), notified({ runId: "r1", agent: "pi", usage: spend(100, 0.01) })]);
  ledger.add([waited({ runId: "r1", agent: "pi", usage: spend(100, 0.01), model: "m" })]);
  ledger.add([fetched({ runId: "r1", agent: "pi", usage: spend(120, 0.02), model: "m" })]);
  // A later delivery without usage, or with malformed usage, does not erase it.
  ledger.add([
    notified({ runId: "r1", agent: "pi" }),
    fetched({ runId: "r1", agent: "pi", usage: { ...spend(1, 1), cost: -1 } }),
  ]);
  const usage = ledger.usage!;
  assert.deepEqual(rows(ledger), [["pi", 120, 0.02, 1]]);
  assert.deepEqual([usage.total.totalTokens, usage.total.cost, usage.total.runs], [120, 0.02, 1]);
  assert.equal(usage.profiles[0]?.model, "m");
});

test("`since` follows the last entry read, and a reset after a miss counts the session afresh", () => {
  const ledger = new RunLedger();
  assert.equal(ledger.since, undefined);
  const first = [said("one"), notified({ runId: "r1", agent: "pi", usage: spend(10, 0.1) })];
  ledger.add(first);
  assert.equal(ledger.since, first.at(-1)!.id);
  ledger.add([]); // Nothing new keeps the place.
  assert.equal(ledger.since, first.at(-1)!.id);
  const later = said("two");
  ledger.add([later]);
  assert.equal(ledger.since, later.id);

  // The session no longer holds `since` (rewritten): the caller resets and reads every entry.
  ledger.reset();
  assert.equal(ledger.since, undefined);
  assert.equal(ledger.usage, undefined);
  const rewritten = [
    notified({ runId: "r1", agent: "pi", usage: spend(10, 0.1) }),
    waited(
      { runId: "r1", agent: "pi", usage: spend(10, 0.1) },
      { runId: "r2", agent: "other", usage: spend(5, 0.05) },
    ),
  ];
  ledger.add(rewritten);
  assert.equal(ledger.since, rewritten.at(-1)!.id);
  assert.deepEqual(rows(ledger), [
    ["pi", 10, 0.1, 1],
    ["other", 5, 0.05, 1],
  ]);
});

test("Profiles sum all five figures across Runs, with a model only when every Run shares one", () => {
  const ledger = new RunLedger().add([
    waited({
      runId: "r1",
      agent: "pi",
      usage: spend(3518, 0.007096, { output: 6 }),
      model: "openai/gpt-6.1-sol",
    }),
    notified({
      runId: "r2",
      agent: "claude",
      usage: spend(10, 0.042112, { output: 106, cacheWrite: 20786 }),
      model: "claude-haiku",
    }),
  ]);
  ledger.add([
    notified({
      runId: "r3",
      agent: "mixed",
      usage: spend(10, 0.001, { cacheRead: 30 }),
      model: "one",
    }),
    fetched({
      runId: "r4",
      agent: "mixed",
      usage: spend(0, 0.002, { output: 5, cacheWrite: 10 }),
      model: "two",
    }),
    notified({ runId: "r5", agent: "unnamed", usage: spend(1, 0.5), model: "only" }),
    notified({ runId: "r6", agent: "unnamed", usage: spend(1, 0.5) }),
  ]);
  const usage = ledger.usage!;
  assert.deepEqual(
    usage.profiles.map((p) => [
      p.profile,
      p.totalTokens,
      Number(p.cost.toFixed(6)),
      p.model ?? null,
      p.models,
      p.runs,
    ]),
    [
      ["pi", 3524, 0.007096, "openai/gpt-6.1-sol", ["openai/gpt-6.1-sol"], 1],
      ["claude", 20902, 0.042112, "claude-haiku", ["claude-haiku"], 1],
      ["mixed", 55, 0.003, null, ["one", "two"], 2],
      ["unnamed", 2, 1, null, ["only"], 2],
    ],
  );
  const mixed = usage.profiles[2]!;
  assert.deepEqual([mixed.input, mixed.output, mixed.cacheRead, mixed.cacheWrite], [10, 5, 30, 10]);
  assert.deepEqual(
    [usage.total.totalTokens, Number(usage.total.cost.toFixed(6)), usage.total.runs],
    [24483, 1.052208, 6],
  );
});

test("Runs are told apart by their Pi IDs while shown Profiles stay redacted", () => {
  // Both IDs would display as [REDACTED]; they are still two Runs.
  const usage = new RunLedger().add([
    notified({ runId: "ghp_firstRun1", agent: "token=hunter22", usage: spend(1, 0.1) }),
    notified({ runId: "ghp_secondRun2", agent: "token=hunter22", usage: spend(2, 0.2) }),
  ]).usage!;
  assert.deepEqual(
    usage.profiles.map((p) => [p.profile, p.totalTokens, p.runs]),
    [["token=[REDACTED]", 3, 2]],
  );
  assert.doesNotMatch(JSON.stringify(usage), /hunter22|ghp_/);
});
