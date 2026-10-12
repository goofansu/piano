/**
 * Subagent Run spend across a whole Pi session. Pi's own totals count every session entry,
 * including history compaction removed and other branches, so the Runs beside them do too.
 */
import type { ProfileUsage, RenderMsg, RunUsage, SubagentUsage } from "../shared/wire.ts";
import { type RawMessage, serializeMessages } from "./PiRecords.ts";

interface RunRecord {
  profile: string;
  usage: RunUsage;
  model?: string;
}

const total = (records: ReadonlyArray<RunRecord>) => {
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const { usage } of records)
    for (const key of Object.keys(sum) as (keyof RunUsage)[]) sum[key] += usage[key];
  return {
    ...sum,
    totalTokens: sum.input + sum.output + sum.cacheRead + sum.cacheWrite,
    runs: records.length,
  };
};

/**
 * Subagent spend by Profile, from the usage pi-subagent delivers with each Run. A Run may be
 * delivered by its Notification, a wait and `agent_result`; one record per Run, the last
 * usage-bearing delivery winning, keeps a repeated Result from adding spend twice.
 * Undefined when no delivery carried usage, which differs from Runs that spent nothing.
 */
export function subagentUsage(messages: ReadonlyArray<RenderMsg>): SubagentUsage | undefined {
  const runs = new Map<string, RunRecord>();
  const deliver = (
    runId: string | undefined,
    profile: string | undefined,
    usage: RunUsage | undefined,
    model: string | undefined,
  ) => {
    if (!runId || !profile || !usage) return;
    runs.set(runId, { profile, usage, ...(model ? { model } : {}) });
  };
  for (const { subagent: card } of messages) {
    if (card?.kind === "result") deliver(card.runId, card.profile, card.usage, card.model);
    if (card?.kind === "collection")
      for (const run of card.runs) deliver(run.runId, run.profile, run.usage, run.model);
  }
  if (runs.size === 0) return undefined;
  const byProfile = new Map<string, RunRecord[]>();
  for (const record of runs.values())
    byProfile.set(record.profile, [...(byProfile.get(record.profile) ?? []), record]);
  const profiles = [...byProfile].map(([profile, records]): ProfileUsage => {
    const models = [...new Set(records.flatMap((record) => (record.model ? [record.model] : [])))];
    const single = models.length === 1 && records.every((record) => record.model);
    return { profile, ...total(records), models, ...(single ? { model: models[0] } : {}) };
  });
  return { profiles, total: total([...runs.values()]) };
}

const deliveries = new Set(["agent_wait", "agent_wait_all", "agent_result"]);
/** The entries that can deliver a Run, as the messages Pi's context builder would make of them. */
const deliveryOf = (value: unknown): RawMessage | undefined => {
  const entry = value as {
    type?: unknown;
    message?: RawMessage;
    customType?: string;
    content?: RawMessage["content"];
    details?: unknown;
  } | null;
  if (
    entry?.type === "message" &&
    entry.message?.role === "toolResult" &&
    deliveries.has(entry.message.toolName ?? "")
  )
    return entry.message;
  if (entry?.type === "custom_message" && entry.customType === "subagent-notification")
    return {
      role: "custom",
      customType: entry.customType,
      content: entry.content ?? "",
      details: entry.details,
    };
  return undefined;
};

/** Reads a session's entries once, in order; `since` is where the next read continues. */
export class RunLedger {
  private delivered: RenderMsg[] = [];
  since: string | undefined;

  add(entries: ReadonlyArray<unknown>) {
    const messages = entries.flatMap((entry) => deliveryOf(entry) ?? []);
    this.delivered.push(...serializeMessages(messages).filter((message) => message.subagent));
    const last = entries.at(-1) as { id?: unknown } | undefined;
    if (typeof last?.id === "string") this.since = last.id;
    return this;
  }

  reset() {
    this.delivered = [];
    this.since = undefined;
  }

  get usage() {
    return subagentUsage(this.delivered);
  }
}
