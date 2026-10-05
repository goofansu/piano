import { useEffect, useRef } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { ContextUsage, ModelCatalog, QueuedMessage, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { composerCard } from "@/lib/styles";
import { formatTokenCount } from "@/lib/format";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EffortSelect, levelsFor } from "@/components/EffortSelect";
import { ModelSelect } from "@/components/ModelSelect";

interface Props {
  text: string;
  onTextChange: (text: string) => void;
  onTextAppend: (text: string) => void;
  onRestoreQueue: () => void;
  disabled: boolean;
  streaming: boolean;
  compacting?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  catalog: ModelCatalog | null;
  model: string | undefined;
  onModelChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  context?: ContextUsage;
  cost?: number;
  totalTokens?: number;
  responseModel?: string;
  responseEffort?: string;
  queuedMessages?: ReadonlyArray<QueuedMessage>;
}

/** The composer: a layer-1 card that lines up with the transcript column. */
export function Composer({ text, onTextChange, onTextAppend, onRestoreQueue, disabled, streaming, compacting, onSend, onStop, catalog, model, onModelChange, effort, onEffortChange, context, cost, totalTokens, responseModel, responseEffort, queuedMessages = [] }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The box grows with its text up to a cap, whichever way the text got there.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);
  useTypeToFocus(ref, onTextAppend, !disabled);
  const send = () => {
    const t = text.trim();
    if (disabled || !t) return;
    onSend(t);
    onTextChange("");
  };
  const tokens = context?.tokens ?? null;
  const selectedModel = catalog?.models.find((m) => m.ref === (model || catalog.defaultModel));
  const contextWindow = context?.contextWindow ?? selectedModel?.contextWindow;
  const percent = context?.percent ?? null;
  const left = percent === null ? null : Math.max(0, 100 - percent);
  const hasText = text.trim().length > 0;
  const showStop = streaming && !hasText;

  return (
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 md:px-6">
      <div className={cn("mx-auto w-full max-w-2xl", composerCard)}>
        {queuedMessages.length > 0 && (
          <section className="border-b border-line px-4 py-3 text-sm" aria-label="Queued messages">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
              <h2 className="font-medium text-ink-2">{streaming ? "Queued messages" : "Paused queue"} ({queuedMessages.length})</h2>
              {!streaming && (
                <Button variant="ghost" size="sm" aria-label="Restore queued messages to draft" disabled={disabled} onClick={() => { onRestoreQueue(); ref.current?.focus(); }}>
                  Restore to draft
                </Button>
              )}
            </div>
            <ol className="max-h-[min(9rem,20dvh)] space-y-2 overflow-y-auto">
              {queuedMessages.map((message, index) => (
                <li key={`${message.kind}-${index}`} className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-ink-3">{message.kind === "steering" ? "Steering" : "Follow-up"}</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words">{message.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <Textarea
          ref={ref}
          value={text}
          disabled={disabled}
          rows={1}
          aria-label="Message"
          placeholder={compacting ? "Pi is compacting. Ordinary input may be rejected." : streaming ? "Send a follow-up; extension commands run immediately." : "What should Pi do next?"}
          className="max-h-48 min-h-12 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0"
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229 && !e.repeat && !window.matchMedia("(pointer: coarse)").matches) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape" && streaming) {
              e.preventDefault();
              onStop();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2.5 text-sm text-ink-2">
          <ModelSelect catalog={catalog} value={model} onChange={onModelChange} disabled={disabled} />
          <EffortSelect value={effort} onChange={onEffortChange} levels={levelsFor(catalog, model || catalog?.defaultModel)} defaultLevel={catalog?.defaultThinkingLevel} disabled={disabled} />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Context usage"
                aria-description={tokens === null ? "Context usage unavailable" : `${tokens.toLocaleString()} tokens`}
                className={cn("h-8 gap-1.5 whitespace-nowrap px-2 tabular-nums", left !== null && left < 15 && "text-warn")}
              >
                <span className="relative inline-block size-3.5 rounded-full border border-current/40" aria-hidden>
                  {percent !== null && (
                    <span className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(currentColor ${Math.min(100, percent)}%, transparent 0)` }} />
                  )}
                </span>
                {tokens === null ? "—" : formatTokenCount(tokens)}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" aria-label="Context usage details" className="w-64 max-w-[calc(100vw-2rem)] space-y-1 text-sm">
              <p>{tokens === null ? "Context usage unavailable" : `Context: ${tokens.toLocaleString()} tokens`}</p>
              {contextWindow !== undefined && contextWindow > 0 && <p className="text-ink-2">Context window: {contextWindow.toLocaleString()} tokens</p>}
              {left !== null && <p className="text-ink-2">{left < 1 ? left.toFixed(1) : Math.round(left)}% left</p>}
              {totalTokens !== undefined && <p className="text-ink-2">Session total: {totalTokens.toLocaleString()} tokens</p>}
              {cost !== undefined && <p className="text-ink-2">${cost.toFixed(2)} so far</p>}
              {responseModel && <p className="break-words text-ink-2">Last response: {responseModel}{responseEffort ? ` · ${responseEffort}` : ""}</p>}
            </PopoverContent>
          </Popover>
          <Button
            size="icon-sm"
            variant={showStop ? "outline" : "default"}
            className="ml-auto rounded-full"
            aria-label={showStop ? "Stop" : streaming && !compacting ? "Queue message" : "Send"}
            title={showStop ? "Abort current operation. Pending queued input is not cleared." : undefined}
            disabled={disabled || (!showStop && !hasText)}
            onClick={showStop ? onStop : send}
          >
            {showStop ? <SquareIcon className="size-3.5 fill-current" /> : <ArrowUpIcon />}
          </Button>
        </div>
      </div>
    </div>
  );
}
