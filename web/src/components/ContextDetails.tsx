import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type ContextFigures, cacheHit, type SessionUsage } from "@/lib/contextUsage";
import { formatTokenCount } from "@/lib/format";

interface Props {
  figures: ContextFigures;
  /** Subagent usage is the server's count over the whole session, not only the messages in context. */
  usage?: SessionUsage;
  messages: ReadonlyArray<RenderMsg>;
}

const number = (value: number) => value.toLocaleString();
const dollars = (value: number) => `$${value.toFixed(4)}`;

/** History usage is per response, not a reconstruction of Pi's current context. */
export function ContextDetails({ figures, usage: session, messages }: Props) {
  const { cost, tokens: totals, subagents } = session ?? {};
  const responses = messages.filter(message => message.role === "assistant" && message.usage);
  const [selectedId, setSelectedId] = useState<string>();
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const selected = responses.find(message => message.id === selectedId) ?? responses.at(-1);
  const values = responses.map(message => metric === "tokens" ? message.usage!.totalTokens : message.usage!.cost);
  const max = Math.max(0, ...values);
  const usage = selected?.usage;
  const position = selected ? responses.indexOf(selected) + 1 : 0;
  const chartRef = useRef<HTMLDivElement>(null);
  const chartWidth = responses.length * 12;
  // A Run that spent nothing is still a Run, but not a row worth reading.
  const spent = subagents?.profiles.filter(profile => profile.totalTokens > 0 || profile.cost > 0) ?? [];

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
      <h2 className="font-medium">{figures.heading}</h2>
      {figures.window !== undefined && <p className="text-ink-2">Context window: {number(figures.window)} tokens</p>}
      {figures.used && (
        <Progress
          value={figures.used.value}
          aria-label="Context window used"
          aria-valuetext={figures.used.text}
          className={cn("h-1.5", figures.low && "*:data-[slot=progress-indicator]:bg-warning")}
        />
      )}
      {figures.left !== null && <p className="text-ink-2">{figures.left}</p>}
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
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable to scroll. */}
        {/* biome-ignore lint/a11y/useSemanticElements: a <section> region would add a landmark inside a popover. */}
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
    <section className="flex flex-col gap-3">
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
          ["Cache hit", cacheHit(usage), cacheHit(totals)],
          ["Total tokens", usage?.totalTokens, totals?.total], ["Cost", usage?.cost, cost],
        ] as const).map(([label, response, session]) => <TableRow key={label}>
          <TableHead scope="row" className="text-left font-normal text-ink-2">{label}</TableHead>
          {[response, session].map((value, index) => /* biome-ignore lint/suspicious/noArrayIndexKey: two fixed columns. */ <TableCell key={index} className="break-all">{value === undefined ? "—" : label === "Cost" ? dollars(value) : label === "Cache hit" ? `${value}%` : number(value)}</TableCell>)}
        </TableRow>)}</TableBody>
      </Table>
      {totals && <p className="sr-only">Session total: {number(totals.total)} tokens</p>}
      {subagents && spent.length > 0 && (
        <Table className="table-fixed text-right text-xs tabular-nums" aria-label="Subagent usage by profile">
          <TableHeader>
            <TableRow className="text-ink-2">
              <TableHead className="w-1/2 text-left font-normal">Subagents</TableHead>
              <TableHead className="text-right font-normal">Tokens</TableHead>
              <TableHead className="text-right font-normal">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {spent.map(profile => <TableRow key={profile.profile}>
              <TableHead scope="row" className="whitespace-normal text-left font-normal text-ink-2">
                <span className="block wrap-anywhere">{profile.profile}</span>
                {profile.model && <span className="block wrap-anywhere text-ink-3">{profile.model}</span>}
              </TableHead>
              <TableCell className="break-all">{number(profile.totalTokens)}</TableCell>
              <TableCell className="break-all">{dollars(profile.cost)}</TableCell>
            </TableRow>)}
            <TableRow>
              <TableHead scope="row" className="text-left font-normal text-ink-2">All subagents</TableHead>
              <TableCell className="break-all">{number(subagents.total.totalTokens)}</TableCell>
              <TableCell className="break-all">{dollars(subagents.total.cost)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </section>
  </div>;
}
