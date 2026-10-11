import assert from "node:assert/strict";
import { test } from "node:test";
import { subagentUsage } from "../server/RunLedger.ts";
import type { RenderMsg, RunUsage, SubagentCard } from "../shared/wire.ts";

const spend = (input: number, cost: number, rest: Partial<RunUsage> = {}): RunUsage => ({ input, output: 0, cacheRead: 0, cacheWrite: 0, cost, ...rest });
const msg = (subagent: SubagentCard, id = Math.random().toString(36)): RenderMsg => ({ id, role: "tool_result", text: "", subagent });
const notice = (runId: string, profile: string, usage?: RunUsage, model?: string) =>
  msg({ kind: "result", source: "notification", runId, profile, status: "Completed", terminalStatus: "completed", ...(usage ? { usage } : {}), ...(model ? { model } : {}) });
const fetched = (runId: string, profile: string, usage?: RunUsage, model?: string) =>
  msg({ kind: "result", source: "tool", runId, profile, status: "Completed", terminalStatus: "completed", ...(usage ? { usage } : {}), ...(model ? { model } : {}) });
const waited = (...runs: { runId: string; profile: string; usage?: RunUsage; model?: string }[]) =>
  msg({ kind: "collection", scope: "named", status: "Delivered", runs: runs.map(run => ({ ...run, status: "completed" as const })), stillRunning: 0, unknown: 0, unavailable: 0, noActiveRuns: false });

test("absent usage folds to nothing, unlike Runs that spent nothing", () => {
  assert.equal(subagentUsage([notice("r1", "a"), fetched("r2", "b"), waited({ runId: "r3", profile: "c" })]), undefined);
  const zero = subagentUsage([waited({ runId: "r1", profile: "a", usage: spend(0, 0) })])!;
  assert.deepEqual(zero.profiles.map(p => [p.profile, p.totalTokens, p.cost, p.runs]), [["a", 0, 0, 1]]);
});

test("a Run delivered on every channel counts once, the last usage-bearing delivery winning", () => {
  const usage = subagentUsage([
    notice("r1", "pi", spend(100, 0.01), "m"),
    waited({ runId: "r1", profile: "pi", usage: spend(100, 0.01), model: "m" }),
    fetched("r1", "pi", spend(120, 0.02), "m"),
    notice("r1", "pi"), // A later delivery without usage does not erase it.
  ])!;
  assert.deepEqual(usage.profiles.map(p => [p.profile, p.totalTokens, p.cost, p.runs]), [["pi", 120, 0.02, 1]]);
  assert.deepEqual([usage.total.totalTokens, usage.total.cost, usage.total.runs], [120, 0.02, 1]);
});

test("Profiles sum all five figures across Runs, with a model only when every Run shares one", () => {
  const usage = subagentUsage([
    waited({ runId: "r1", profile: "pi", usage: spend(3518, 0.007096, { output: 6 }), model: "openai/gpt-6.1-sol" }),
    notice("r2", "claude", spend(10, 0.042112, { output: 106, cacheWrite: 20786 }), "claude-haiku"),
    notice("r3", "mixed", spend(10, 0.001, { cacheRead: 30 }), "one"),
    notice("r4", "mixed", spend(0, 0.002, { output: 5, cacheWrite: 10 }), "two"),
    notice("r5", "unnamed", spend(1, 0.5), "only"),
    notice("r6", "unnamed", spend(1, 0.5)),
  ])!;
  assert.deepEqual(usage.profiles.map(p => [p.profile, p.totalTokens, Number(p.cost.toFixed(6)), p.model ?? null, p.models, p.runs]), [
    ["pi", 3524, 0.007096, "openai/gpt-6.1-sol", ["openai/gpt-6.1-sol"], 1],
    ["claude", 20902, 0.042112, "claude-haiku", ["claude-haiku"], 1],
    ["mixed", 55, 0.003, null, ["one", "two"], 2],
    ["unnamed", 2, 1, null, ["only"], 2],
  ]);
  const mixed = usage.profiles[2]!;
  assert.deepEqual([mixed.input, mixed.output, mixed.cacheRead, mixed.cacheWrite], [10, 5, 30, 10]);
  assert.deepEqual([usage.total.totalTokens, Number(usage.total.cost.toFixed(6)), usage.total.runs], [24483, 1.052208, 6]);
});
