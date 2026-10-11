import type { RenderMsg, RunUsage } from "@shared/wire";

type Figures = Pick<RunUsage, "input" | "cacheRead" | "cacheWrite">;

/** Share of prompt tokens served from cache; undefined without any prompt tokens. */
export const cacheHit = (usage?: Figures) => {
  if (!usage) return undefined;
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  return input > 0 ? Math.round(100 * usage.cacheRead / input) : undefined;
};

export interface UsageTotal extends RunUsage {
  totalTokens: number;
  cacheHit?: number;
  runs: number;
}

export interface ProfileUsage extends UsageTotal {
  profile: string;
  /** Models the Profile's Runs reported; a Run without one adds nothing here. */
  models: string[];
  /** Every Run named a model, and all named the same one. */
  model?: string;
}

export interface SubagentUsage {
  /** In order of each Profile's first delivered Run, including Runs that spent nothing. */
  profiles: ProfileUsage[];
  total: UsageTotal;
}

interface RunRecord { profile: string; usage: RunUsage; model?: string }

const total = (records: ReadonlyArray<RunRecord>): UsageTotal => {
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const { usage } of records) for (const key of Object.keys(sum) as (keyof RunUsage)[]) sum[key] += usage[key];
  const hit = cacheHit(sum);
  return { ...sum, totalTokens: sum.input + sum.output + sum.cacheRead + sum.cacheWrite, ...(hit !== undefined ? { cacheHit: hit } : {}), runs: records.length };
};

/**
 * Subagent spend by Profile, from the usage pi-subagent delivers with each Run. A Run may be
 * delivered by its Notification, a wait and `agent_result`; one record per Run, the last
 * usage-bearing delivery winning, keeps a repeated Result from adding spend twice.
 * Undefined when no delivery carried usage, which differs from Runs that spent nothing.
 */
export function subagentUsage(messages: ReadonlyArray<RenderMsg>): SubagentUsage | undefined {
  const runs = new Map<string, RunRecord>();
  const deliver = (runId: string | undefined, profile: string | undefined, usage: RunUsage | undefined, model: string | undefined) => {
    if (!runId || !profile || !usage) return;
    runs.set(runId, { profile, usage, ...(model ? { model } : {}) });
  };
  for (const { subagent: card } of messages) {
    if (card?.kind === "result") deliver(card.runId, card.profile, card.usage, card.model);
    if (card?.kind === "collection") for (const run of card.runs) deliver(run.runId, run.profile, run.usage, run.model);
  }
  if (runs.size === 0) return undefined;
  const byProfile = new Map<string, RunRecord[]>();
  for (const record of runs.values()) byProfile.set(record.profile, [...byProfile.get(record.profile) ?? [], record]);
  const profiles = [...byProfile].map(([profile, records]): ProfileUsage => {
    const models = [...new Set(records.flatMap(record => record.model ? [record.model] : []))];
    const single = models.length === 1 && records.every(record => record.model);
    return { profile, ...total(records), models, ...(single ? { model: models[0] } : {}) };
  });
  return { profiles, total: total([...runs.values()]) };
}
