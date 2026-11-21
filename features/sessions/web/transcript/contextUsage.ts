import type { ModelCatalog, RenderMsg, SessionState, SessionStats, Usage } from "@shared/wire";
import { formatTokenCount } from "../../../../web/src/shared/lib/format.ts";

export type SessionUsage = Pick<SessionState, "context" | "cost" | "tokens">;

export interface ContextFigures {
  readonly tokens: number | null;
  readonly window: number | undefined;
  readonly label: string;
  readonly description: string;
  readonly heading: string;
  readonly low: boolean;
  readonly used: { readonly value: number; readonly text: string } | null;
  readonly left: string | null;
}

const LOW_PERCENT_LEFT = 15;

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

export function cacheHit(
  usage?: Pick<NonNullable<SessionStats["tokens"]>, "input" | "cacheRead" | "cacheWrite">,
): number | undefined {
  if (!usage) return undefined;
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  return input > 0 ? Math.round((100 * usage.cacheRead) / input) : undefined;
}

const number = (value: number) => value.toLocaleString();
const dollars = (value: number) => `$${value.toFixed(4)}`;

export type HistoryMetric = "tokens" | "cost";

export type UsageResponse = RenderMsg & { readonly usage: Usage };

export interface ResponseHistory {
  readonly responses: ReadonlyArray<UsageResponse>;
  readonly values: ReadonlyArray<number>;
  readonly peak: number;
  readonly peakText: string;
  readonly selected: UsageResponse | undefined;
  readonly position: number;
}

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

export interface BreakdownRow {
  readonly label: string;
  readonly response: string;
  readonly session: string;
}

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
