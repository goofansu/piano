import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type ContextFigures,
  type HistoryMetric,
  responseHistory,
  type SessionUsage,
  subagentRows,
  usageBreakdown,
} from "@/lib/contextUsage";

interface Props {
  figures: ContextFigures;
  /** Subagent usage is the server's count over the whole session, not only the messages in context. */
  usage?: SessionUsage;
  messages: ReadonlyArray<RenderMsg>;
}

/** History usage is per response, not a reconstruction of Pi's current context. */
export function ContextDetails({ figures, usage: session, messages }: Props) {
  const [selectedId, setSelectedId] = useState<string>();
  const [metric, setMetric] = useState<HistoryMetric>("tokens");
  const { responses, values, peak, peakText, selected, position } = responseHistory(
    messages,
    metric,
    selectedId,
  );
  const breakdown = usageBreakdown(selected?.usage, session);
  const subagents = subagentRows(session?.subagents);
  const totals = session?.tokens;
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

  return (
    <div className="flex flex-col gap-4 text-sm">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{figures.heading}</h2>
        {figures.window !== undefined && (
          <p className="text-ink-2">Context window: {figures.window.toLocaleString()} tokens</p>
        )}
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
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={metric}
            onValueChange={(value) => {
              if (value) setMetric(value as HistoryMetric);
            }}
            aria-label="Graph metric"
          >
            <ToggleGroupItem value="tokens" aria-label="Show tokens history" className="text-xs">
              Tokens
            </ToggleGroupItem>
            <ToggleGroupItem value="cost" aria-label="Show cost history" className="text-xs">
              Cost
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {responses.length === 0 ? (
          <Empty className="p-4 md:p-4">
            <EmptyHeader>
              <EmptyDescription>No response usage available yet.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <p className="text-xs text-ink-2">
              {metric === "tokens" ? "Tokens" : "Cost"} per response · peak {peakText}
            </p>
            {/* biome-ignore lint/a11y/useSemanticElements: a <section> region would add a landmark inside a popover. */}
            <div
              ref={chartRef}
              className="min-w-0 overflow-x-auto overscroll-x-contain"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable to scroll.
              tabIndex={0}
              role="region"
              aria-label="Scrollable response chart"
            >
              <svg
                viewBox={`0 0 ${chartWidth} 80`}
                preserveAspectRatio="none"
                style={{ minWidth: chartWidth }}
                className="block h-20 w-full text-ink-2"
                role="img"
                aria-label={`${metric === "tokens" ? "Token" : "Cost"} history across ${responses.length} responses. Use the response slider for exact values.`}
              >
                {values.map((value, index) => (
                  <rect
                    key={responses[index].id}
                    x={index * 12}
                    y={80 - (peak > 0 ? (value / peak) * 76 : 0)}
                    width={11}
                    height={peak > 0 ? (value / peak) * 76 : 0}
                    fill="currentColor"
                    opacity={responses[index].id === selected?.id ? 1 : 0.35}
                  />
                ))}
              </svg>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="shrink-0 tabular-nums">
                Response {position} / {responses.length}
              </span>
              <Slider
                aria-label="Inspect response"
                min={1}
                max={responses.length}
                step={1}
                value={[position]}
                onValueChange={([value]) => setSelectedId(responses[value - 1]?.id)}
                className="min-w-0 flex-1"
              />
            </div>
            <p className="break-words text-xs text-ink-2">
              {selected?.model ?? "Model unavailable"}
              {selected?.thinkingLevel ? ` · ${selected.thinkingLevel}` : ""}
            </p>
          </>
        )}
      </section>
      <Separator />
      <section className="flex flex-col gap-3">
        <Table
          className="table-fixed text-right text-xs tabular-nums"
          aria-label="Token and cost breakdown"
        >
          <TableHeader>
            <TableRow className="text-ink-2">
              <TableHead className="w-2/5 text-left font-normal">Usage</TableHead>
              <TableHead className="text-right font-normal">Response</TableHead>
              <TableHead className="text-right font-normal">Session</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breakdown.map((row) => (
              <TableRow key={row.label}>
                <TableHead scope="row" className="text-left font-normal text-ink-2">
                  {row.label}
                </TableHead>
                <TableCell className="break-all">{row.response}</TableCell>
                <TableCell className="break-all">{row.session}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {totals && <p className="sr-only">Session total: {totals.total.toLocaleString()} tokens</p>}
        {subagents && (
          <Table
            className="table-fixed text-right text-xs tabular-nums"
            aria-label="Subagent usage by profile"
          >
            <TableHeader>
              <TableRow className="text-ink-2">
                <TableHead className="w-2/5 text-left font-normal">Subagents</TableHead>
                <TableHead className="text-right font-normal">Tokens</TableHead>
                <TableHead className="text-right font-normal">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* A Profile row may wrap to two lines: pad it and keep the figures on the Profile's line. */}
              {subagents.rows.map((row) => (
                <TableRow key={row.profile} className="*:py-2.5 *:align-top">
                  <TableHead
                    scope="row"
                    className="h-auto whitespace-normal text-left font-normal text-ink-2"
                  >
                    <span className="block wrap-anywhere">{row.profile}</span>
                    {/* The model ID alone; the provider stays in the tooltip. */}
                    {row.model && (
                      <span className="mt-1 block wrap-anywhere text-ink-3" title={row.modelRef}>
                        {row.model}
                      </span>
                    )}
                  </TableHead>
                  <TableCell className="break-all">{row.tokens}</TableCell>
                  <TableCell className="break-all">{row.cost}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableHead scope="row" className="text-left font-normal text-ink-2">
                  All subagents
                </TableHead>
                <TableCell className="break-all">{subagents.total.tokens}</TableCell>
                <TableCell className="break-all">{subagents.total.cost}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
