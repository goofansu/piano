import { useEffect, useRef, useState } from "react";
import type { ContextUsage, RenderMsg, SessionStats } from "@shared/wire";
import { cn } from "cn";
import { formatTokenCount } from "@/lib/format";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface Props {
  context?: ContextUsage;
  contextWindow?: number;
  cost?: number;
  totals?: SessionStats["tokens"];
  messages: ReadonlyArray<RenderMsg>;
}

const number = (value: number) => value.toLocaleString();
const dollars = (value: number) => `$${value.toFixed(4)}`;

/** History usage is per response, not a reconstruction of Pi's current context. */
export function ContextDetails({ context, contextWindow, cost, totals, messages }: Props) {
  const responses = messages.filter(message => message.role === "assistant" && message.usage);
  const [selectedId, setSelectedId] = useState<string>();
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const selected = responses.find(message => message.id === selectedId) ?? responses.at(-1);
  const values = responses.map(message => metric === "tokens" ? message.usage!.totalTokens : message.usage!.cost);
  const max = Math.max(0, ...values);
  const tokens = context?.tokens ?? null;
  const percent = tokens === null ? null : context?.percent ?? null;
  const left = percent === null ? null : Math.max(0, 100 - percent);
  const inputTokens = totals ? totals.input + totals.cacheRead + totals.cacheWrite : 0;
  const cachePercent = totals && inputTokens > 0 ? Math.round(100 * totals.cacheRead / inputTokens) : null;
  const usage = selected?.usage;
  const position = selected ? responses.indexOf(selected) + 1 : 0;
  const chartRef = useRef<HTMLDivElement>(null);
  const chartWidth = responses.length * 12;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || position === 0) return;
    const step = chart.scrollWidth / responses.length;
    const start = (position - 1) * step;
    const end = position * step;
    if (start < chart.scrollLeft) chart.scrollLeft = start;
    else if (end > chart.scrollLeft + chart.clientWidth) chart.scrollLeft = end - chart.clientWidth;
  }, [position, responses.length]);

  return <div className="flex flex-col gap-4 text-sm">
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{tokens === null ? "Context usage unavailable" : `Context: ${number(tokens)} tokens`}</h2>
      {contextWindow !== undefined && contextWindow > 0 && <p className="text-ink-2">Context window: {number(contextWindow)} tokens</p>}
      {percent !== null && (
        <Progress
          value={Math.max(0, Math.min(100, percent))}
          aria-label="Context window used"
          aria-valuetext={`${percent.toFixed(1)}% used`}
          className={cn("h-1.5", left !== null && left < 15 && "*:data-[slot=progress-indicator]:bg-warning")}
        />
      )}
      {left !== null && <p className="text-ink-2">{left < 1 ? left.toFixed(1) : Math.round(left)}% left</p>}
      {cachePercent !== null && <p className="text-ink-2" title="Cached input / total input">Session cache hit rate: {cachePercent}%</p>}
    </section>
    <Separator />
    <section className="flex flex-col gap-2" aria-label="Response usage history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Response history</h3>
        <ToggleGroup type="single" size="sm" variant="outline" value={metric} onValueChange={value => { if (value) setMetric(value as "tokens" | "cost"); }} aria-label="Graph metric">
          <ToggleGroupItem value="tokens" aria-label="Show tokens history" className="text-xs">Tokens</ToggleGroupItem>
          <ToggleGroupItem value="cost" aria-label="Show cost history" className="text-xs">Cost</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {responses.length === 0 ? (
        <Empty className="p-4 md:p-4">
          <EmptyHeader><EmptyDescription>No response usage available yet.</EmptyDescription></EmptyHeader>
        </Empty>
      ) : <>
        <p className="text-xs text-ink-2">{metric === "tokens" ? "Tokens" : "Cost"} per response · peak {metric === "tokens" ? formatTokenCount(max) : dollars(max)}</p>
        <div ref={chartRef} className="min-w-0 overflow-x-auto overscroll-x-contain" tabIndex={0} role="region" aria-label="Scrollable response chart">
          <svg viewBox={`0 0 ${chartWidth} 80`} preserveAspectRatio="none" style={{ minWidth: chartWidth }} className="block h-20 w-full text-ink-2" role="img" aria-label={`${metric === "tokens" ? "Token" : "Cost"} history across ${responses.length} responses. Use the response slider for exact values.`}>
            {values.map((value, index) => <rect key={responses[index].id} className="transition-[opacity,height,y] duration-300" x={index * 12} y={80 - (max > 0 ? value / max * 76 : 0)} width={11} height={max > 0 ? value / max * 76 : 0} fill="currentColor" opacity={responses[index].id === selected?.id ? 1 : 0.35} />)}
          </svg>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="shrink-0 tabular-nums">Response {position} / {responses.length}</span>
          <Slider aria-label="Inspect response" min={1} max={responses.length} step={1} value={[position]} onValueChange={([value]) => setSelectedId(responses[value - 1]?.id)} className="min-w-0 flex-1" />
        </div>
        <p className="break-words text-xs text-ink-2">{selected?.model ?? "Model unavailable"}{selected?.thinkingLevel ? ` · ${selected.thinkingLevel}` : ""}</p>
      </>}
    </section>
    <Separator />
    <section>
      <Table className="table-fixed text-right text-xs tabular-nums" aria-label="Token and cost breakdown">
        <TableHeader>
          <TableRow className="text-ink-2">
            <TableHead className="w-2/5 text-left font-normal">Usage</TableHead>
            <TableHead className="text-right font-normal">Response</TableHead>
            <TableHead className="text-right font-normal">Session</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{([
          ["Input", usage?.input, totals?.input], ["Output", usage?.output, totals?.output],
          ["Cache read", usage?.cacheRead, totals?.cacheRead], ["Cache write", usage?.cacheWrite, totals?.cacheWrite],
          ["Total tokens", usage?.totalTokens, totals?.total], ["Cost", usage?.cost, cost],
        ] as const).map(([label, response, session]) => <TableRow key={label}>
          <TableHead scope="row" className="text-left font-normal text-ink-2">{label}</TableHead>
          {[response, session].map((value, index) => <TableCell key={index} className="break-all">{value === undefined ? "—" : label === "Cost" ? dollars(value) : number(value)}</TableCell>)}
        </TableRow>)}</TableBody>
      </Table>
      {totals && <p className="sr-only">Session total: {number(totals.total)} tokens</p>}
    </section>
  </div>;
}
