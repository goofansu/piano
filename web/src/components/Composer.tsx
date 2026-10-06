import { useEffect, useRef } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { AttachButton, AttachmentDraftView, attachmentEvents, useAttachments } from "@/components/Attachments";
import type { Attachment, ContextUsage, ModelCatalog, QueuedMessage, RenderMsg, SessionStats, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { composerAction, composerCard, composerInput, composerToolbar } from "@/lib/styles";
import { formatTokenCount } from "@/lib/format";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelSelect } from "@/components/ModelSelect";
import { ContextDetails } from "@/components/ContextDetails";

interface Props {
  draftKey: string;
  text: string;
  onTextChange: (text: string) => void;
  onTextAppend: (text: string) => void;
  onRestoreQueue: () => void;
  disabled: boolean;
  streaming: boolean;
  compacting?: boolean;
  onSend: (text: string, kind: QueuedMessage["kind"], attachments: readonly Attachment[]) => void;
  onStop: () => void;
  catalog: ModelCatalog | null;
  onRefreshModels?: () => void;
  model: string | undefined;
  onModelChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  context?: ContextUsage;
  cost?: number;
  totals?: SessionStats["tokens"];
  messages?: ReadonlyArray<RenderMsg>;
  queuedMessages?: ReadonlyArray<QueuedMessage>;
}

/** The composer: a layer-1 card that lines up with the transcript column. */
export function Composer({ draftKey, text, onTextChange, onTextAppend, onRestoreQueue, disabled, streaming, compacting, onSend, onStop, catalog, onRefreshModels, model, onModelChange, effort, onEffortChange, context, cost, totals, messages = [], queuedMessages = [] }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments(draftKey);
  const imagesWaiting = streaming && attachments.items.length > 0;
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
    if (disabled || attachments.busy || imagesWaiting || (!t && !attachments.items.length)) return;
    onSend(t, kind, attachments.items);
    onTextChange("");
    attachments.clear();
  };
  const tokens = context?.tokens ?? null;
  const selectedModel = catalog?.models.find((m) => m.ref === (model || catalog.defaultModel));
  const contextWindow = context?.contextWindow ?? selectedModel?.contextWindow;
  const percent = tokens === null ? null : context?.percent ?? null;
  const left = percent === null ? null : Math.max(0, 100 - percent);
  const inputTokens = totals ? totals.input + totals.cacheRead + totals.cacheWrite : 0;
  const cachePercent = totals && inputTokens > 0 ? Math.round(100 * totals.cacheRead / inputTokens) : null;
  const contextLabel = percent !== null ? `${Math.round(percent)}%` : tokens !== null ? formatTokenCount(tokens) : "—";
  const hasText = text.trim().length > 0 || attachments.items.length > 0;
  const showStop = streaming && !hasText;
  const showSteer = streaming && !compacting && hasText;
  const showQueueKinds = queuedMessages.some(message => message.kind === "steering");

  return (
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-6 md:pb-5">
      <div className={cn("mx-auto w-full max-w-3xl", composerCard)} {...attachmentEvents(attachments, disabled)}>
        <AttachmentDraftView draft={attachments} disabled={disabled} />
        {imagesWaiting && <p role="status" className="animate-in px-4 pt-2 text-sm text-ink-2 fade-in-0 slide-in-from-top-1">Images are ready. Wait for Pi to finish before sending.</p>}
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
            <ol className="flex max-h-[min(9rem,20dvh)] flex-col gap-2 overflow-y-auto">
              {queuedMessages.map((message, index) => (
                <li key={`${message.kind}-${index}`} className="flex min-w-0 animate-in gap-2 fade-in-0">
                  {showQueueKinds && <Badge variant={message.kind === "steering" ? "outline" : "secondary"} className="shrink-0">{message.kind === "steering" ? "Steering" : "Follow-up"}</Badge>}
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
          {showSteer && !attachments.items.length && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  className="control-enter mr-2.5 mb-2.5 h-11 shrink-0 rounded-xl px-2"
                  aria-label="Steer"
                  disabled={disabled}
                  onClick={() => send("steering")}
                >
                  Steer
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send before the next model call, after current tools finish <Kbd>Alt</Kbd><Kbd>Enter</Kbd></TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className={composerToolbar}>
          <AttachButton draft={attachments} disabled={disabled} />
          <ModelSelect catalog={catalog} onRefresh={onRefreshModels} value={model} onChange={onModelChange} effort={effort} onEffortChange={onEffortChange} disabled={disabled} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={showStop ? "outline" : "default"}
                className={composerAction}
                aria-label={showStop ? "Stop" : streaming && !compacting ? "Queue message" : "Send"}
                disabled={disabled || (!showStop && (!hasText || attachments.busy || imagesWaiting))}
                onClick={showStop ? onStop : () => send()}
              >
                <span key={showStop ? "stop" : "send"} className="control-enter inline-flex" aria-hidden>
                  {showStop ? <SquareIcon className="fill-current" /> : <ArrowUpIcon />}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {showStop ? "Abort current operation. Pending queued input is not cleared." : <>{streaming && !compacting ? "Send after the agent finishes" : "Send"} <Kbd>Enter</Kbd></>}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mx-auto flex min-h-8 w-full max-w-3xl items-center justify-end gap-2 whitespace-nowrap font-mono text-xs text-ink-2 tabular-nums" aria-label="Session usage">
        {cachePercent !== null && <>
          <span className="text-brand" title="Session cache hit rate: cached input / total input" aria-label={`Session cache hit rate: ${cachePercent}%`}>cache {cachePercent}%</span>
          <Separator orientation="vertical" className="h-3!" />
        </>}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Context usage"
              aria-description={tokens === null ? "Context usage unavailable" : `${tokens.toLocaleString()} tokens`}
              className={cn("px-1.5 font-mono text-xs font-normal", left !== null && left < 15 && "text-warning hover:text-warning")}
            >
              {contextLabel}{contextWindow !== undefined && contextWindow > 0 ? `/${formatTokenCount(contextWindow)}` : ""}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" aria-label="Context usage details" className="w-96 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto font-mono">
            <ContextDetails context={context} contextWindow={contextWindow} cost={cost} totals={totals} messages={messages} />
          </PopoverContent>
        </Popover>
        {cost !== undefined && Number.isFinite(cost) && <>
          <Separator orientation="vertical" className="h-3!" />
          <span aria-label={`Session cost: $${cost.toFixed(2)}`} title="Session cost">${cost.toFixed(2)}</span>
        </>}
      </div>
    </div>
  );
}
