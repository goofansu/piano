import { useState } from "react";
import type { ContextUsage, RenderMsg, SessionStats } from "@shared/wire";
import { formatTokenCount } from "@/lib/format";

interface Props {
  context?: ContextUsage;
  contextWindow?: number;
  cost?: number;
  totals?: SessionStats["tokens"];
  messages: ReadonlyArray<RenderMsg>;
  responseModel?: string;
  responseEffort?: string;
}

const number = (value: number) => value.toLocaleString();
const dollars = (value: number) => `$${value.toFixed(4)}`;

/** History usage is per response, not a reconstruction of Pi's current context. */
export function ContextDetails({ context, contextWindow, cost, totals, messages, responseModel, responseEffort }: Props) {
  const responses = messages.filter(message => message.role === "assistant" && message.usage);
  const [selectedId, setSelectedId] = useState<string>();
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const selected = responses.find(message => message.id === selectedId) ?? responses.at(-1);
  const values = responses.map(message => metric === "tokens" ? message.usage!.totalTokens : message.usage!.cost);
  const max = Math.max(0, ...values);
  const tokens = context?.tokens ?? null;
  const percent = tokens === null ? null : context?.percent ?? null;
  const left = percent === null ? null : Math.max(0, 100 - percent);
  const usage = selected?.usage;
  return <div className="space-y-4 text-sm">
    <section className="space-y-2">
      <h2 className="font-medium">{tokens === null ? "Context usage unavailable" : `Context: ${number(tokens)} tokens`}</h2>
      {contextWindow !== undefined && contextWindow > 0 && <p className="text-ink-2">Context window: {number(contextWindow)} tokens</p>}
      {percent !== null && <div role="meter" aria-label="Context window used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, percent))} aria-valuetext={`${percent.toFixed(1)}% used`} className="h-1.5 overflow-hidden rounded-full bg-current/10">
        <div className={left !== null && left < 15 ? "h-full bg-warn" : "h-full bg-ink-2"} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>}
      {left !== null && <p className="text-ink-2">{left < 1 ? left.toFixed(1) : Math.round(left)}% left</p>}
    </section>
    <section className="space-y-2 border-t border-line pt-3" aria-label="Response usage history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Response history</h3>
        <div className="flex gap-1" aria-label="Graph metric">
          {(["tokens", "cost"] as const).map(value => <button key={value} type="button" aria-label={`Show ${value} history`} aria-pressed={metric === value} onClick={() => setMetric(value)} className="rounded px-2 py-1 text-xs hover:bg-current/10 aria-pressed:bg-current/10">{value === "tokens" ? "Tokens" : "Cost"}</button>)}
        </div>
      </div>
      {responses.length === 0 ? <p className="text-ink-2">No response usage available yet.</p> : <>
        <p className="text-xs text-ink-2">{metric === "tokens" ? "Total tokens" : "Cost"} per response · peak {metric === "tokens" ? formatTokenCount(max) : dollars(max)}</p>
        <svg viewBox="0 0 400 80" className="h-20 w-full text-ink-2" role="img" aria-label={`${metric === "tokens" ? "Token" : "Cost"} history across ${responses.length} responses. Use the response slider for exact values.`}>
          {values.map((value, index) => <rect key={responses[index].id} x={index * 400 / values.length} y={80 - (max > 0 ? value / max * 76 : 0)} width={Math.max(0.5, 400 / values.length - 1)} height={max > 0 ? value / max * 76 : 0} fill="currentColor" opacity={responses[index].id === selected?.id ? 1 : 0.35} />)}
        </svg>
        <label className="flex items-center gap-3 text-xs">Response {responses.indexOf(selected!) + 1} / {responses.length}
          <input className="min-w-0 flex-1" type="range" aria-label="Inspect response" min={1} max={responses.length} value={responses.indexOf(selected!) + 1} onChange={event => setSelectedId(responses[Number(event.target.value) - 1].id)} />
        </label>
        <p className="break-words text-xs text-ink-2">{selected?.model ?? "Model unavailable"}{selected?.thinkingLevel ? ` · ${selected.thinkingLevel}` : ""}</p>
      </>}
    </section>
    <section className="border-t border-line pt-3">
      <table className="w-full table-fixed text-right text-xs tabular-nums" aria-label="Token and cost breakdown">
        <thead><tr className="text-ink-2"><th scope="col" className="w-2/5 pb-2 text-left font-normal">Usage</th><th scope="col" className="pb-2 font-normal">Response</th><th scope="col" className="pb-2 font-normal">Session</th></tr></thead>
        <tbody>{([
          ["Input", usage?.input, totals?.input], ["Output", usage?.output, totals?.output],
          ["Cache read", usage?.cacheRead, totals?.cacheRead], ["Cache write", usage?.cacheWrite, totals?.cacheWrite],
          ["Total tokens", usage?.totalTokens, totals?.total], ["Cost", usage?.cost, cost],
        ] as const).map(([label, response, session]) => <tr key={label}>
          <th scope="row" className="py-1 text-left font-normal text-ink-2">{label}</th>
          {[response, session].map((value, index) => <td key={index} className="break-all py-1">{value === undefined ? "—" : label === "Cost" ? dollars(value) : number(value)}</td>)}
        </tr>)}</tbody>
      </table>
      {totals && <p className="sr-only">Session total: {number(totals.total)} tokens</p>}
      {responseModel && <p className="mt-3 break-words text-xs text-ink-2">Last response: {responseModel}{responseEffort ? ` · ${responseEffort}` : ""}</p>}
      <p className="mt-2 text-xs text-ink-3">Pi-reported usage. History shows responses with usage in the current transcript, not current context size. — means unavailable.</p>
    </section>
  </div>;
}
