import { useEffect, useRef } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { ContextUsage, ModelCatalog, QueuedMessage, RenderMsg, SessionStats, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { composerAction, composerCard, composerInput, composerToolbar } from "@/lib/styles";
import { formatTokenCount } from "@/lib/format";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelSelect } from "@/components/ModelSelect";
import { ContextDetails } from "@/components/ContextDetails";

interface Props {
  text: string;
  onTextChange: (text: string) => void;
  onTextAppend: (text: string) => void;
  onRestoreQueue: () => void;
  disabled: boolean;
  streaming: boolean;
  compacting?: boolean;
  onSend: (text: string, kind: QueuedMessage["kind"]) => void;
  onStop: () => void;
  catalog: ModelCatalog | null;
  model: string | undefined;
  onModelChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  context?: ContextUsage;
  cost?: number;
  totals?: SessionStats["tokens"];
  messages?: ReadonlyArray<RenderMsg>;
  responseModel?: string;
  responseEffort?: string;
  queuedMessages?: ReadonlyArray<QueuedMessage>;
}

/** The composer: a layer-1 card that lines up with the transcript column. */
export function Composer({ text, onTextChange, onTextAppend, onRestoreQueue, disabled, streaming, compacting, onSend, onStop, catalog, model, onModelChange, effort, onEffortChange, context, cost, totals, messages = [], responseModel, responseEffort, queuedMessages = [] }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The box grows with its text up to a cap, whichever way the text got there.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);
  useTypeToFocus(ref, onTextAppend, !disabled);
  const send = (kind: QueuedMessage["kind"] = "follow-up") => {
    const t = text.trim();
    if (disabled || !t) return;
    onSend(t, kind);
    onTextChange("");
  };
  const tokens = context?.tokens ?? null;
  const selectedModel = catalog?.models.find((m) => m.ref === (model || catalog.defaultModel));
  const contextWindow = context?.contextWindow ?? selectedModel?.contextWindow;
  const percent = context?.percent ?? null;
  const left = percent === null ? null : Math.max(0, 100 - percent);
  const hasText = text.trim().length > 0;
  const showStop = streaming && !hasText;
  const showSteer = streaming && !compacting && hasText;
  const showQueueKinds = queuedMessages.some(message => message.kind === "steering");

  return (
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-6 md:pb-5">
      <div className={cn("mx-auto w-full max-w-3xl", composerCard)}>
        {queuedMessages.length > 0 && (
          <section className="control-enter border-b border-line px-4 py-3 text-sm" aria-label="Queued messages">
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
                  {showQueueKinds && <span className="shrink-0 text-ink-3">{message.kind === "steering" ? "Steering" : "Follow-up"}</span>}
                  <span className="min-w-0 whitespace-pre-wrap break-words">{message.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="flex items-end">
          <Textarea
            ref={ref}
            value={text}
            disabled={disabled}
            rows={1}
            aria-label="Message"
            className={cn(composerInput, "min-w-0 flex-1")}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing &&
                  e.nativeEvent.keyCode !== 229 && !e.repeat && !window.matchMedia("(pointer: coarse)").matches) {
                e.preventDefault();
                send(e.altKey ? "steering" : "follow-up");
              } else if (e.key === "Escape" && streaming) {
                e.preventDefault();
                onStop();
              }
            }}
          />
          {showSteer && (
            <Button
              variant="outline"
              className="mb-2.5 mr-2.5 h-11 shrink-0 rounded-xl px-2"
              aria-label="Steer"
              title="Send before the next model call, after current tools finish (Alt+Enter)"
              disabled={disabled}
              onClick={() => send("steering")}
            >
              Steer
            </Button>
          )}
        </div>
        <div className={composerToolbar}>
          <ModelSelect catalog={catalog} value={model} onChange={onModelChange} effort={effort} onEffortChange={onEffortChange} disabled={disabled} />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Context usage"
                aria-description={tokens === null ? "Context usage unavailable" : `${tokens.toLocaleString()} tokens`}
                className={cn("h-11 min-w-11 shrink-0 gap-1.5 whitespace-nowrap px-2 tabular-nums md:h-8", left !== null && left < 15 && "text-warn")}
              >
                <span className="relative inline-block size-3.5 rounded-full border border-current/40" aria-hidden>
                  {percent !== null && (
                    <span className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(currentColor ${Math.min(100, percent)}%, transparent 0)` }} />
                  )}
                </span>
                {tokens === null ? "—" : formatTokenCount(tokens)}
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" aria-label="Context usage details" className="w-96 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto font-mono">
              <ContextDetails context={context} contextWindow={contextWindow} cost={cost} totals={totals} messages={messages} responseModel={responseModel} responseEffort={responseEffort} />
            </PopoverContent>
          </Popover>
          <Button
            size="icon"
            variant={showStop ? "outline" : "default"}
            className={composerAction}
            aria-label={showStop ? "Stop" : streaming && !compacting ? "Queue message" : "Send"}
            title={showStop ? "Abort current operation. Pending queued input is not cleared." : streaming && !compacting ? "Send after the agent finishes (Enter)" : "Send (Enter)"}
            disabled={disabled || (!showStop && !hasText)}
            onClick={showStop ? onStop : () => send()}
          >
            <span key={showStop ? "stop" : "send"} className="control-enter inline-flex" aria-hidden>
              {showStop ? <SquareIcon className="size-3.5 fill-current" /> : <ArrowUpIcon />}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
