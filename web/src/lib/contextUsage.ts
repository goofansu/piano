import type { ModelCatalog, RenderMsg, SessionState, SessionStats, Usage } from "@shared/wire";
import { formatTokenCount } from "./format.ts";

/** What Pi reports about a session's spending: current context, full-session totals and Run usage. */
export type SessionUsage = Pick<SessionState, "context" | "cost" | "tokens" | "subagents">;

/** The context figures the usage button and its popover show, derived once from the same inputs. */
export interface ContextFigures {
  /** Tokens Pi counts in the current context; `null` until Pi reports them. */
  readonly tokens: number | null;
  /** The context window in tokens, from Pi or else the selected model; absent when unknown. */
  readonly window: number | undefined;
  /** The usage button's text, such as `21%/200k`, `200k` before the first reply, or `—`. */
  readonly label: string;
  /** The usage button's accessible description. */
  readonly description: string;
  /** The popover's heading. */
  readonly heading: string;
  /** Little of the window is left, so both surfaces show the warning colour. */
  readonly low: boolean;
  /** The progress bar, when Pi reports a percentage. */
  readonly used: { readonly value: number; readonly text: string } | null;
  /** Such as `85% left`, when Pi reports a percentage. */
  readonly left: string | null;
}

/** Below this share of the window left, the usage figures turn to the warning colour. */
const LOW_PERCENT_LEFT = 15;

/** Derive the context figures from the session's usage, falling back to the catalog's window for `model`. */
export function contextFigures(
  context: SessionUsage["context"],
  catalog: ModelCatalog | null,
  model: string | undefined,
): ContextFigures {
  const tokens = context?.tokens ?? null;
  const fallback = catalog?.models.find(
    (m) => m.ref === (model || catalog.defaultModel),
  )?.contextWindow;
  const known = context?.contextWindow ?? fallback;
  const window = known !== undefined && known > 0 ? known : undefined;
  const percent = tokens === null ? null : (context?.percent ?? null);
  const left = percent === null ? null : Math.max(0, 100 - percent);
  const usedLabel =
    percent !== null
      ? `${Math.round(percent)}%`
      : tokens !== null
        ? formatTokenCount(tokens)
        : null;
  const windowLabel = window === undefined ? null : formatTokenCount(window);
  return {
    tokens,
    window,
    // Before the first reply only the window is known, so it stands alone rather than reading as "—/1k".
    label:
      usedLabel && windowLabel ? `${usedLabel}/${windowLabel}` : (usedLabel ?? windowLabel ?? "—"),
    description:
      tokens === null ? "Context usage unavailable" : `${tokens.toLocaleString()} tokens`,
    heading:
      tokens === null ? "Context usage unavailable" : `Context: ${tokens.toLocaleString()} tokens`,
    low: left !== null && left < LOW_PERCENT_LEFT,
    used:
      percent === null
        ? null
        : { value: Math.max(0, Math.min(100, percent)), text: `${percent.toFixed(1)}% used` },
    left: left === null ? null : `${left < 1 ? left.toFixed(1) : Math.round(left)}% left`,
  };
}

/** The share of input tokens served from cache, as a whole percentage; absent without input. */
export function cacheHit(
  usage?: Pick<NonNullable<SessionStats["tokens"]>, "input" | "cacheRead" | "cacheWrite">,
): number | undefined {
  if (!usage) return undefined;
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  return input > 0 ? Math.round((100 * usage.cacheRead) / input) : undefined;
}

const number = (value: number) => value.toLocaleString();
const dollars = (value: number) => `$${value.toFixed(4)}`;

/** Which figure the response history graphs. */
export type HistoryMetric = "tokens" | "cost";

/** A transcript response that carries Pi's usage for it. */
export type UsageResponse = RenderMsg & { readonly usage: Usage };

/** The response history graph and slider: per-response values and the inspected response. */
export interface ResponseHistory {
  /** Assistant responses with usage, in transcript order. */
  readonly responses: ReadonlyArray<UsageResponse>;
  /** Each response's figure for the metric, aligned with `responses`. */
  readonly values: ReadonlyArray<number>;
  /** The largest value, or 0 without responses. */
  readonly peak: number;
  /** The peak as the caption shows it, such as `12k` or `$0.0123`. */
  readonly peakText: string;
  /** The inspected response: the chosen one, else the latest. */
  readonly selected: UsageResponse | undefined;
  /** The inspected response's 1-based position, or 0 without responses. */
  readonly position: number;
}

/** History usage is per response, not a reconstruction of Pi's current context. */
export function responseHistory(
  messages: ReadonlyArray<RenderMsg>,
  metric: HistoryMetric,
  selectedId: string | undefined,
): ResponseHistory {
  const responses = messages.filter(
    (message): message is UsageResponse => message.role === "assistant" && !!message.usage,
  );
  const selected = responses.find((message) => message.id === selectedId) ?? responses.at(-1);
  const values = responses.map((message) =>
    metric === "tokens" ? message.usage.totalTokens : message.usage.cost,
  );
  const peak = Math.max(0, ...values);
  return {
    responses,
    values,
    peak,
    peakText: metric === "tokens" ? formatTokenCount(peak) : dollars(peak),
    selected,
    position: selected ? responses.indexOf(selected) + 1 : 0,
  };
}

/** One row of the token and cost breakdown, formatted, with `—` where a figure is unknown. */
export interface BreakdownRow {
  readonly label: string;
  readonly response: string;
  readonly session: string;
}

/** The inspected response's usage beside Pi's main-session totals, which exclude subagents. */
export function usageBreakdown(
  response: Usage | undefined,
  session: Pick<SessionUsage, "tokens" | "cost"> | undefined,
): ReadonlyArray<BreakdownRow> {
  const totals = session?.tokens;
  const percent = (value: number) => `${value}%`;
  const row = (
    label: string,
    format: (value: number) => string,
    ofResponse: number | undefined,
    ofSession: number | undefined,
  ): BreakdownRow => ({
    label,
    response: ofResponse === undefined ? "—" : format(ofResponse),
    session: ofSession === undefined ? "—" : format(ofSession),
  });
  return [
    row("Input", number, response?.input, totals?.input),
    row("Output", number, response?.output, totals?.output),
    row("Cache read", number, response?.cacheRead, totals?.cacheRead),
    row("Cache write", number, response?.cacheWrite, totals?.cacheWrite),
    row("Cache hit", percent, cacheHit(response), cacheHit(totals)),
    row("Total tokens", number, response?.totalTokens, totals?.total),
    row("Cost", dollars, response?.cost, session?.cost),
  ];
}

/** One Profile's row in the subagents table, formatted. */
export interface SubagentRow {
  readonly profile: string;
  /** The model ID without its provider, when every Run named the same model. */
  readonly model?: string;
  /** The full model reference, provider included, for the tooltip. */
  readonly modelRef?: string;
  readonly tokens: string;
  readonly cost: string;
}

/** The subagents table: Profiles that spent anything, then the total over every Run. */
export interface SubagentTable {
  readonly rows: ReadonlyArray<SubagentRow>;
  readonly total: { readonly tokens: string; readonly cost: string };
}

/** The subagents table, or `null` when no Profile spent anything and the table stays hidden. */
export function subagentRows(subagents: SessionUsage["subagents"]): SubagentTable | null {
  // A Run that spent nothing is still a Run, but not a row worth reading.
  const spent =
    subagents?.profiles.filter((profile) => profile.totalTokens > 0 || profile.cost > 0) ?? [];
  if (!subagents || spent.length === 0) return null;
  return {
    rows: spent.map((profile) => ({
      profile: profile.profile,
      ...(profile.model && {
        model: profile.model.slice(profile.model.indexOf("/") + 1),
        modelRef: profile.model,
      }),
      tokens: number(profile.totalTokens),
      cost: dollars(profile.cost),
    })),
    total: { tokens: number(subagents.total.totalTokens), cost: dollars(subagents.total.cost) },
  };
}
