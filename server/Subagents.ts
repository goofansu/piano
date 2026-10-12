/**
 * The pi-subagent extension contract: the `details` its tools and notifications attach, read as
 * cards (`SubagentProjection`) and as Run spend across a whole session (`RunLedger`).
 * PiRecords stays the Pi RPC protocol translator and asks this module about subagent payloads.
 * This is a split by concept (extension contract versus Pi protocol), not by file size.
 */
import type {
  ProfileUsage,
  RenderMsg,
  RunUsage,
  SubagentCard,
  SubagentUsage,
} from "../shared/wire.ts";
import { redactDisplay } from "./DisplayProjection.ts";

type DetailRecord = Record<string, unknown>;
type RunMeta = { subagentId?: string; label?: string; profile?: string };
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  /^[A-Za-z0-9._:-]+$/.test(value);
const bounded = (value: unknown, max = 500): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const recordOf = (value: unknown): DetailRecord | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as DetailRecord)
    : undefined;
const terminal = (value: unknown): value is "completed" | "failed" | "cancelled" =>
  value === "completed" || value === "failed" || value === "cancelled";
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const tone = (value: unknown, result = false) =>
  value === "toolTitle" ||
  value === "warning" ||
  value === "error" ||
  (result && value === "toolOutput");
export const titleStatus = (value: "completed" | "failed" | "cancelled") =>
  value[0].toUpperCase() + value.slice(1);
const figure = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
/** A delivered Run's usage and model, each dropped alone when malformed so the card survives.
 * Never Pi's message-level `usage`: pi-subagent leaves it unset so repeated deliveries do not add up. */
const spendOf = (facts: DetailRecord): { usage?: RunUsage; model?: string } => {
  const usage = recordOf(facts.usage);
  const valid =
    usage &&
    figure(usage.input) &&
    figure(usage.output) &&
    figure(usage.cacheRead) &&
    figure(usage.cacheWrite) &&
    figure(usage.cost);
  const model =
    typeof facts.model === "string" &&
    facts.model.length > 0 &&
    Buffer.byteLength(facts.model) <= 100
      ? facts.model
      : undefined;
  return {
    ...(valid
      ? {
          usage: {
            input: usage.input as number,
            output: usage.output as number,
            cacheRead: usage.cacheRead as number,
            cacheWrite: usage.cacheWrite as number,
            cost: usage.cost as number,
          },
        }
      : {}),
    ...(model ? { model } : {}),
  };
};
const parseArgs = (args: string | undefined): DetailRecord => {
  try {
    return recordOf(args ? JSON.parse(args) : undefined) ?? {};
  } catch {
    return {};
  }
};

/** Correlates only facts already present in Pi's ordered transcript. It never
 * claims that an admitted historical Run is currently active. */
export class SubagentProjection {
  private calls = new Map<string, { name: string; args: string }>();
  private runs = new Map<string, RunMeta>();
  private subagents = new Map<string, RunMeta>();

  reset(): void {
    this.calls.clear();
    this.runs.clear();
    this.subagents.clear();
  }

  assistant(msg: RenderMsg): void {
    for (const call of msg.toolCalls ?? [])
      this.calls.set(call.id, { name: call.name, args: call.args });
  }

  tool(
    toolCallId: string | undefined,
    toolName: string | undefined,
    details: unknown,
    args?: string,
  ): SubagentCard | undefined {
    const call = toolCallId ? this.calls.get(toolCallId) : undefined;
    const name = toolName ?? call?.name;
    const input = parseArgs(args ?? call?.args);
    const facts = recordOf(details);
    if (!facts || !name) return undefined;

    if (
      name === "agent_start" &&
      facts.kind === "start" &&
      bounded(facts.rowPhrase) &&
      bounded(facts.agent) &&
      tone(facts.tone)
    ) {
      const admitted = identifier(facts.subagentId) && identifier(facts.runId);
      if ((facts.subagentId !== undefined || facts.runId !== undefined) && !admitted)
        return undefined;
      const profile = typeof input.agent === "string" ? input.agent : facts.agent;
      const label = typeof input.description === "string" ? input.description : undefined;
      const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
      if (admitted) {
        const meta = { subagentId: facts.subagentId as string, label, profile };
        this.runs.set(facts.runId as string, meta);
        this.subagents.set(facts.subagentId as string, meta);
      }
      return {
        kind: "delegation",
        action: "start",
        profile,
        label,
        prompt,
        status: facts.rowPhrase,
        admitted,
        ...(admitted
          ? { subagentId: facts.subagentId as string, runId: facts.runId as string }
          : {}),
      };
    }
    if (
      name === "agent_resume" &&
      facts.kind === "resume" &&
      bounded(facts.rowPhrase) &&
      tone(facts.tone)
    ) {
      const admitted = identifier(facts.subagentId) && identifier(facts.runId);
      if ((facts.subagentId !== undefined || facts.runId !== undefined) && !admitted)
        return undefined;
      const subagentId = admitted
        ? (facts.subagentId as string)
        : identifier(input.id)
          ? input.id
          : undefined;
      const prior = subagentId ? this.subagents.get(subagentId) : undefined;
      const label = typeof input.description === "string" ? input.description : undefined;
      const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
      const profile = prior?.profile;
      if (admitted) {
        const meta = { subagentId, label, profile };
        this.runs.set(facts.runId as string, meta);
        if (subagentId) this.subagents.set(subagentId, meta);
      }
      return {
        kind: "delegation",
        action: "resume",
        label,
        profile,
        prompt,
        status: facts.rowPhrase,
        admitted,
        ...(subagentId ? { subagentId } : {}),
        ...(admitted ? { runId: facts.runId as string } : {}),
      };
    }
    if (
      name === "agent_steer" &&
      facts.kind === "steer" &&
      bounded(facts.rowPhrase) &&
      tone(facts.tone) &&
      identifier(facts.runId)
    ) {
      return {
        kind: "control",
        action: "steer",
        runId: facts.runId,
        ...this.runs.get(facts.runId),
        message: typeof input.message === "string" ? input.message : undefined,
        status: facts.rowPhrase,
      };
    }
    if ((name === "agent_wait" || name === "agent_wait_all") && facts.kind === "collection") {
      if (
        (facts.scope !== "named" && facts.scope !== "all-active") ||
        !Array.isArray(facts.runs) ||
        !count(facts.stillRunning) ||
        !count(facts.unknown) ||
        !count(facts.unavailable) ||
        typeof facts.noActiveRuns !== "boolean"
      )
        return undefined;
      const runs = facts.runs.flatMap((value) => {
        const run = recordOf(value);
        return run && identifier(run.runId) && bounded(run.agent) && terminal(run.status)
          ? [
              {
                ...this.runs.get(run.runId),
                runId: run.runId,
                profile: run.agent,
                status: run.status,
                ...spendOf(run),
              },
            ]
          : [];
      });
      if (runs.length !== facts.runs.length) return undefined;
      const clauses = [
        runs.length ? `Delivered ${runs.length} ${runs.length === 1 ? "result" : "results"}` : "",
        facts.unavailable ? `${facts.unavailable} unavailable` : "",
        facts.stillRunning ? `${facts.stillRunning} still running when checked` : "",
        facts.unknown ? `${facts.unknown} unknown` : "",
      ].filter(Boolean);
      // A partial wait is a collection outcome, not the one delivered Run's outcome.
      const one =
        runs.length === 1 &&
        facts.stillRunning === 0 &&
        facts.unknown === 0 &&
        facts.unavailable === 0
          ? runs[0]
          : undefined;
      return {
        kind: "collection",
        scope: facts.scope,
        ...(one
          ? {
              runId: one.runId,
              subagentId: one.subagentId,
              label: one.label,
              profile: one.profile,
              terminalStatus: one.status,
            }
          : {}),
        status: one
          ? titleStatus(one.status)
          : facts.noActiveRuns
            ? "No active runs when checked"
            : clauses.join(" · ") || "No run outcomes",
        runs,
        stillRunning: facts.stillRunning,
        unknown: facts.unknown,
        unavailable: facts.unavailable,
        noActiveRuns: facts.noActiveRuns,
      };
    }
    if (
      name === "agent_result" &&
      facts.kind === "result" &&
      bounded(facts.rowPhrase) &&
      tone(facts.tone, true)
    ) {
      if (facts.outcome === "available") {
        const run = recordOf(facts.run);
        if (!run || !identifier(run.runId) || !bounded(run.agent) || !terminal(run.status))
          return undefined;
        return {
          kind: "result",
          source: "tool",
          ...this.runs.get(run.runId),
          runId: run.runId,
          profile: run.agent,
          status: titleStatus(run.status),
          terminalStatus: run.status,
          ...spendOf(run),
        };
      }
      if (
        (facts.outcome === "still-running" || facts.outcome === "unknown") &&
        identifier(facts.runId)
      )
        return {
          kind: "result",
          source: "tool",
          runId: facts.runId,
          ...this.runs.get(facts.runId),
          status:
            facts.outcome === "still-running" ? "Still running when checked" : facts.rowPhrase,
        };
      if (facts.outcome === "unavailable" && identifier(facts.runId) && terminal(facts.status))
        return {
          kind: "result",
          source: "tool",
          runId: facts.runId,
          ...this.runs.get(facts.runId),
          status: `${titleStatus(facts.status)} · Result unavailable`,
          terminalStatus: facts.status,
        };
      return undefined;
    }
    if (name === "agent_cancel" && facts.kind === "cancel" && Array.isArray(facts.outcomes)) {
      const outcomes: Extract<SubagentCard, { kind: "cancellation" }>["outcomes"][number][] = [];
      for (const value of facts.outcomes) {
        const outcome = recordOf(value);
        if (!outcome || !identifier(outcome.runId)) continue;
        if (outcome.kind === "already terminal" && terminal(outcome.phase))
          outcomes.push({ kind: outcome.kind, runId: outcome.runId, phase: outcome.phase });
        else if (
          outcome.kind === "requested" ||
          outcome.kind === "already requested" ||
          outcome.kind === "unknown"
        )
          outcomes.push({ kind: outcome.kind, runId: outcome.runId });
      }
      if (outcomes.length !== facts.outcomes.length) return undefined;
      const requested = outcomes.filter((o) => o.kind === "requested").length;
      const already = outcomes.filter((o) => o.kind === "already requested").length;
      const finished = outcomes.filter((o) => o.kind === "already terminal").length;
      const unknown = outcomes.filter((o) => o.kind === "unknown").length;
      const clauses = [
        requested ? `Cancellation requested: ${requested}` : "",
        already ? `Already cancelling: ${already}` : "",
        finished ? `Already finished: ${finished}` : "",
        unknown ? `Unknown run ids: ${unknown}` : "",
      ].filter(Boolean);
      return {
        kind: "cancellation",
        status: clauses.join(" · ") || "No run ids were given",
        outcomes,
      };
    }
    return undefined;
  }

  notification(details: unknown): SubagentCard | undefined {
    const facts = recordOf(details);
    if (
      !facts ||
      !identifier(facts.runId) ||
      !identifier(facts.subagentId) ||
      !bounded(facts.agent) ||
      !bounded(facts.label) ||
      !terminal(facts.status) ||
      typeof facts.durationMillis !== "number" ||
      !Number.isFinite(facts.durationMillis) ||
      facts.durationMillis < 0
    )
      return undefined;
    const meta = { subagentId: facts.subagentId, label: facts.label, profile: facts.agent };
    this.runs.set(facts.runId, meta);
    this.subagents.set(facts.subagentId, meta);
    return {
      kind: "result",
      source: "notification",
      runId: facts.runId,
      ...meta,
      status: titleStatus(facts.status),
      terminalStatus: facts.status,
      durationMillis: facts.durationMillis,
      ...spendOf(facts),
    };
  }
}

// ── Run ledger ───────────────────────────────────────────────────────────────

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

const DELIVERIES = new Set(["agent_wait", "agent_wait_all", "agent_result"]);
/** The card of a session entry that can deliver a Run: a wait or `agent_result` tool result,
 * or a pi-subagent notification. Every other entry is skipped unread. */
const deliveredCard = (
  projection: SubagentProjection,
  value: unknown,
): SubagentCard | undefined => {
  const entry = recordOf(value);
  const message = recordOf(entry?.message);
  if (
    entry?.type === "message" &&
    message?.role === "toolResult" &&
    typeof message.toolName === "string" &&
    DELIVERIES.has(message.toolName)
  )
    return projection.tool(
      typeof message.toolCallId === "string" ? message.toolCallId : undefined,
      message.toolName,
      message.details,
    );
  if (entry?.type === "custom_message" && entry.customType === "subagent-notification")
    return projection.notification(entry.details);
  return undefined;
};

/**
 * Subagent Run spend across a whole Pi session, read from its entries once and in order.
 * Pi's own totals count every session entry, including history compaction removed and other
 * branches, so the Runs beside them do too. A Run may be delivered by its Notification, a wait
 * and `agent_result`; one record per Run ID, the last usage-bearing delivery winning, keeps a
 * repeated Result from adding spend twice. Only that compact record is retained, keyed by the
 * Run ID as pi-subagent wrote it; redaction applies to what `usage` shows, never to the key.
 */
export class RunLedger {
  private runs = new Map<string, RunRecord>();
  /** The last entry read: where the next read continues. */
  since: string | undefined;

  add(entries: ReadonlyArray<unknown>): this {
    // Spend needs only each delivery's own facts, never correlation with earlier calls.
    const projection = new SubagentProjection();
    const deliver = (
      runId: string | undefined,
      profile: string | undefined,
      usage: RunUsage | undefined,
      model: string | undefined,
    ) => {
      if (runId && profile && usage)
        this.runs.set(runId, { profile, usage, ...(model ? { model } : {}) });
    };
    for (const entry of entries) {
      const card = deliveredCard(projection, entry);
      if (card?.kind === "result") deliver(card.runId, card.profile, card.usage, card.model);
      if (card?.kind === "collection")
        for (const run of card.runs) deliver(run.runId, run.profile, run.usage, run.model);
    }
    const last = recordOf(entries.at(-1));
    if (typeof last?.id === "string") this.since = last.id;
    return this;
  }

  /** Forget every Run, for a session that no longer holds the last entry read. */
  reset(): void {
    this.runs.clear();
    this.since = undefined;
  }

  /** Spend by Profile as the browser shows it. Undefined when no delivery carried usage,
   * which differs from Runs that spent nothing. */
  get usage(): SubagentUsage | undefined {
    if (this.runs.size === 0) return undefined;
    const byProfile = new Map<string, RunRecord[]>();
    for (const run of this.runs.values()) {
      const shown: RunRecord = {
        usage: run.usage,
        profile: redactDisplay(run.profile),
        ...(run.model ? { model: redactDisplay(run.model) } : {}),
      };
      byProfile.set(shown.profile, [...(byProfile.get(shown.profile) ?? []), shown]);
    }
    const profiles = [...byProfile].map(([profile, records]): ProfileUsage => {
      const models = [
        ...new Set(records.flatMap((record) => (record.model ? [record.model] : []))),
      ];
      const single = models.length === 1 && records.every((record) => record.model);
      return { profile, ...total(records), models, ...(single ? { model: models[0] } : {}) };
    });
    return { profiles, total: total([...this.runs.values()]) };
  }
}
