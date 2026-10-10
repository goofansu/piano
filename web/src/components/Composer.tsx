import type { Attachment, ContextUsage, ModelCatalog, QueuedMessage, RenderMsg, SessionStats, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { ArrowUpIcon, ChevronDownIcon, PencilIcon, SquareIcon } from "lucide-react";
import { useRef, useState } from "react";
import { AttachButton, AttachmentDraftView, attachmentEvents, useAttachments } from "@/components/Attachments";
import { ContextDetails } from "@/components/ContextDetails";
import { JumpTo } from "@/components/JumpTo";
import { ModelSelect } from "@/components/ModelSelect";
import { type CompletionContext, SlashTextarea } from "@/components/SlashTextarea";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTokenCount } from "@/lib/format";
import { isSendKey } from "@/lib/keys";
import { readStorage, writeStorage } from "@/lib/storage";
import { composerAction, composerCard, composerInput, composerToolbar, picker } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { useAutoGrow } from "@/lib/useAutoGrow";

interface Props {
  draftKey: string;
  completion?: CompletionContext;
  text: string;
  onTextChange: (text: string) => void;
  onTextAppend: (text: string) => void;
  onRestoreQueue: () => void;
  disabled: boolean;
  streaming: boolean;
  compacting?: boolean;
  onSend: (text: string, kind: QueuedMessage["kind"], attachments: readonly Attachment[]) => void;
  onStop: () => void;
  stopping?: boolean;
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

type QueueMode = QueuedMessage["kind"];
const QUEUE_MODE_KEY = "piano.queueMode";
/** How a message sent while Pi works is delivered. Pi's own editor steers on Enter, so steering is the default. */
const DELIVERY: Record<QueueMode, { label: string; detail: string }> = {
  steering: { label: "steer", detail: "Adjust the current task." },
  "follow-up": { label: "follow-up", detail: "Add work after the current task." },
};
const MODES: readonly QueueMode[] = ["steering", "follow-up"];
const otherMode = (mode: QueueMode): QueueMode => (mode === "steering" ? "follow-up" : "steering");
const loadQueueMode = (): QueueMode => (readStorage(QUEUE_MODE_KEY) === "follow-up" ? "follow-up" : "steering");

/** The composer: a layer-1 card that lines up with the transcript column. */
export function Composer({ draftKey, completion, text, onTextChange, onTextAppend, onRestoreQueue, disabled, streaming, compacting, onSend, onStop, stopping, catalog, onRefreshModels, model, onModelChange, effort, onEffortChange, context, cost, totals, messages = [], queuedMessages = [] }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments(draftKey);
  // The delivery mode is a sticky preference; the alternative always stays on Alt+Enter.
  const [queueMode, setQueueModeState] = useState<QueueMode>(loadQueueMode);
  const setQueueMode = (mode: QueueMode) => {
    setQueueModeState(mode);
    writeStorage(QUEUE_MODE_KEY, mode);
  };
  const imagesWaiting = streaming && attachments.items.length > 0;
  useAutoGrow(ref, text, 192);
  useTypeToFocus(ref, onTextAppend, !disabled);
  const send = (kind: QueueMode = queueMode) => {
    const t = text.trim();
    if (disabled || stopping || attachments.busy || imagesWaiting || (!t && !attachments.items.length)) return;
    // Nothing can steer a compaction; whatever is sent then waits for it to finish.
    onSend(t, compacting ? "follow-up" : kind, attachments.items);
    onTextChange("");
    attachments.clear();
  };
  const tokens = context?.tokens ?? null;
  const selectedModel = catalog?.models.find((m) => m.ref === (model || catalog.defaultModel));
  const contextWindow = context?.contextWindow ?? selectedModel?.contextWindow;
  const percent = tokens === null ? null : context?.percent ?? null;
  const left = percent === null ? null : Math.max(0, 100 - percent);
  const used = percent !== null ? `${Math.round(percent)}%` : tokens !== null ? formatTokenCount(tokens) : null;
  const window = contextWindow !== undefined && contextWindow > 0 ? formatTokenCount(contextWindow) : null;
  // Before the first reply only the window is known, so it stands alone rather than reading as "—/1k".
  const contextLabel = used && window ? `${used}/${window}` : used ?? window ?? "—";
  const hasText = text.trim().length > 0 || attachments.items.length > 0;
  const showStop = streaming && !hasText;
  const showDelivery = streaming && !compacting;
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
              <Button variant="ghost" size="sm" className="h-11 shrink-0 md:h-8" aria-label={queuedMessages.length === 1 ? "Edit queued message" : "Edit all queued messages"} title="Move queued messages back to the draft without stopping Pi (Esc)" disabled={disabled || stopping} onClick={() => { onRestoreQueue(); ref.current?.focus(); }}>
                <PencilIcon data-icon="inline-start" aria-hidden />
                {queuedMessages.length === 1 ? "Edit" : "Edit all"}
              </Button>
            </div>
            <ol className="flex max-h-[min(9rem,20dvh)] flex-col gap-2 overflow-y-auto">
              {queuedMessages.map((message, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: queued messages carry no id and may repeat text.
                <li key={`${message.kind}-${index}`} className="flex min-w-0 animate-in flex-col gap-1 fade-in-0">
                  {showQueueKinds && <span className="text-xs text-ink-3">{message.kind === "steering" ? "Steering" : "Follow-up"}</span>}
                  <span className="min-w-0 whitespace-pre-wrap break-words">{message.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="flex items-end">
          <SlashTextarea
            ref={ref}
            completion={completion}
            value={text}
            disabled={disabled}
            rows={1}
            aria-label="Message"
            className={cn(composerInput, "min-w-0 flex-1")}
            onValueChange={onTextChange}
            onKeyDown={(e) => {
              if (isSendKey(e)) {
                e.preventDefault();
                send(e.altKey ? otherMode(queueMode) : queueMode);
              } else if (e.key === "Escape" && !disabled && !stopping) {
                // Esc acts on the nearest thing first: queued messages return to the draft, then the next press stops Pi.
                if (queuedMessages.length > 0) {
                  e.preventDefault();
                  onRestoreQueue();
                } else if (streaming) {
                  e.preventDefault();
                  onStop();
                }
              }
            }}
          />
        </div>
        <div className={composerToolbar}>
          <AttachButton draft={attachments} disabled={disabled} />
          <ModelSelect catalog={catalog} onRefresh={onRefreshModels} value={model} onChange={onModelChange} effort={effort} onEffortChange={onEffortChange} disabled={disabled} />
          {showDelivery && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className={cn(picker, "control-enter shrink-0")} aria-label={`Delivery: ${DELIVERY[queueMode].label}`} disabled={disabled}>
                  {DELIVERY[queueMode].label}
                  <ChevronDownIcon className="text-ink-3" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuRadioGroup value={queueMode} onValueChange={(mode) => setQueueMode(mode as QueueMode)}>
                  {MODES.map((mode) => (
                    <DropdownMenuRadioItem key={mode} value={mode}>
                      {/* Two lines in one column, so the item's trailing check centers on both. */}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          {DELIVERY[mode].label}
                          <KbdGroup className="ml-auto">{mode !== queueMode && <Kbd>Alt</Kbd>}<Kbd>Enter</Kbd></KbdGroup>
                        </span>
                        <span className="text-xs text-muted-foreground">{DELIVERY[mode].detail}</span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* Send and Stop are one control; its face cross-fades so the key never jumps. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={showStop ? "outline" : "default"}
                className={cn(composerAction, "relative")}
                aria-label={showStop ? "Stop" : showDelivery ? DELIVERY[queueMode].label : streaming ? "Queue message" : "Send"}
                disabled={stopping || (showStop ? disabled : disabled || !hasText || attachments.busy || imagesWaiting)}
                onClick={showStop ? onStop : () => send()}
              >
                <span aria-hidden className={cn("absolute inset-0 grid place-items-center transition-[opacity,transform] duration-(--dur-enter) ease-(--ease-enter)", showStop ? "scale-75 opacity-0" : "scale-100 opacity-100")}><ArrowUpIcon /></span>
                <span aria-hidden className={cn("absolute inset-0 grid place-items-center transition-[opacity,transform] duration-(--dur-enter) ease-(--ease-enter)", showStop ? "scale-100 opacity-100" : "scale-75 opacity-0")}><SquareIcon className="fill-current" /></span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {showStop
                ? queuedMessages.length > 0 ? <>Stop and move queued input to the draft. <Kbd>Esc</Kbd> edits without stopping.</> : <>Stop <Kbd>Esc</Kbd></>
                : <>{showDelivery ? `${DELIVERY[queueMode].label}: ${DELIVERY[queueMode].detail}` : streaming ? "Send after compaction finishes" : "Send"} <Kbd>Enter</Kbd></>}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mx-auto flex min-h-8 w-full max-w-3xl items-center gap-2 whitespace-nowrap text-ink-2">
        {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form semantics and min-content sizing to a row of status buttons. */}
        <div className="ml-auto flex shrink-0 items-center gap-2" role="group" aria-label="Session usage">
          <JumpTo messages={messages} />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Context usage"
                aria-description={tokens === null ? "Context usage unavailable" : `${tokens.toLocaleString()} tokens`}
                className={cn("chrome-label px-1.5", left !== null && left < 15 && "text-warning hover:text-warning")}
              >
                {contextLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" aria-label="Context usage details" className="w-96 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto font-mono">
              <ContextDetails context={context} contextWindow={contextWindow} cost={cost} totals={totals} messages={messages} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
