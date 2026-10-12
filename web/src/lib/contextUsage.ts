import type { ModelCatalog, SessionState, SessionStats } from "@shared/wire";
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
