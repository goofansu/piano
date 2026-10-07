import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon, ChevronDownIcon, SquareIcon } from "lucide-react";
import { AttachButton, AttachmentDraftView, attachmentEvents, useAttachments } from "@/components/Attachments";
import type { Attachment, ContextUsage, ModelCatalog, QueuedMessage, RenderMsg, SessionStats, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { composerAction, composerCard, composerInput, composerToolbar, picker } from "@/lib/styles";
import { abbrevPath, formatTokenCount } from "@/lib/format";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelSelect } from "@/components/ModelSelect";
import { ContextDetails } from "@/components/ContextDetails";
import { JumpTo } from "@/components/JumpTo";

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
  /** Directory the session runs in; shown abbreviated at the left of the usage row. */
  cwd?: string;
}

type QueueMode = QueuedMessage["kind"];
const QUEUE_MODE_KEY = "piano.queueMode";
/** How a message sent while Pi works is delivered. Pi's own editor steers on Enter, so steering is the default. */
const DELIVERY: Record<QueueMode, { label: string; detail: string }> = {
  steering: { label: "Steer", detail: "After the current tool calls, before the next model call." },
  "follow-up": { label: "Follow-up", detail: "After Pi finishes the current task." },
};
const MODES: readonly QueueMode[] = ["steering", "follow-up"];
const otherMode = (mode: QueueMode): QueueMode => (mode === "steering" ? "follow-up" : "steering");
const loadQueueMode = (): QueueMode => {
  try {
    return localStorage.getItem(QUEUE_MODE_KEY) === "follow-up" ? "follow-up" : "steering";
  } catch {
    return "steering";
  }
};

/** The composer: a layer-1 card that lines up with the transcript column. */
export function Composer({ draftKey, text, onTextChange, onTextAppend, onRestoreQueue, disabled, streaming, compacting, onSend, onStop, catalog, onRefreshModels, model, onModelChange, effort, onEffortChange, context, cost, totals, messages = [], queuedMessages = [], cwd }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments(draftKey);
  // The delivery mode is a sticky preference; the alternative always stays on Alt+Enter.
  const [queueMode, setQueueModeState] = useState<QueueMode>(loadQueueMode);
  const setQueueMode = (mode: QueueMode) => {
    setQueueModeState(mode);
    try {
      localStorage.setItem(QUEUE_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };
  const imagesWaiting = streaming && attachments.items.length > 0;
  // The box grows with its text up to a cap, whichever way the text got there.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);
  useTypeToFocus(ref, onTextAppend, !disabled);
  const send = (kind: QueueMode = queueMode) => {
    const t = text.trim();
    if (disabled || attachments.busy || imagesWaiting || (!t && !attachments.items.length)) return;
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
  const contextLabel = percent !== null ? `${Math.round(percent)}%` : tokens !== null ? formatTokenCount(tokens) : "—";
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
                send(e.altKey ? otherMode(queueMode) : queueMode);
              } else if (e.key === "Escape" && streaming) {
                e.preventDefault();
                onStop();
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
                <Button variant="ghost" size="sm" className={cn(picker, "control-enter h-11 shrink-0 md:h-8")} aria-label={`Delivery: ${DELIVERY[queueMode].label}`} disabled={disabled}>
                  {DELIVERY[queueMode].label}
                  <ChevronDownIcon className="text-ink-3" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuRadioGroup value={queueMode} onValueChange={(mode) => setQueueMode(mode as QueueMode)}>
                  {MODES.map((mode) => (
                    <DropdownMenuRadioItem key={mode} value={mode} className="flex-col items-start gap-0.5">
                      <span className="flex w-full items-center gap-2">
                        {DELIVERY[mode].label}
                        <KbdGroup className="ml-auto">{mode !== queueMode && <Kbd>Alt</Kbd>}<Kbd>Enter</Kbd></KbdGroup>
                      </span>
                      <span className="text-xs text-muted-foreground">{DELIVERY[mode].detail}</span>
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
                disabled={showStop ? disabled : disabled || !hasText || attachments.busy || imagesWaiting}
                onClick={showStop ? onStop : () => send()}
              >
                <span aria-hidden className={cn("absolute inset-0 grid place-items-center transition-[opacity,transform] duration-(--dur-enter) ease-(--ease-enter)", showStop ? "scale-75 opacity-0" : "scale-100 opacity-100")}><ArrowUpIcon /></span>
                <span aria-hidden className={cn("absolute inset-0 grid place-items-center transition-[opacity,transform] duration-(--dur-enter) ease-(--ease-enter)", showStop ? "scale-100 opacity-100" : "scale-75 opacity-0")}><SquareIcon className="fill-current" /></span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {showStop
                ? <>Stop. Queued input is kept. <Kbd>Esc</Kbd></>
                : <>{showDelivery ? `${DELIVERY[queueMode].label}: ${DELIVERY[queueMode].detail}` : streaming ? "Send after compaction finishes" : "Send"} <Kbd>Enter</Kbd></>}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mx-auto flex min-h-8 w-full max-w-3xl items-center gap-2 whitespace-nowrap font-mono text-xs text-ink-2 tabular-nums">
        {cwd && <PathLabel cwd={cwd} />}
        <div className="ml-auto flex shrink-0 items-center gap-2" aria-label="Session usage">
          <JumpTo messages={messages} />
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
        </div>
      </div>
    </div>
  );
}

/** The session directory the way hydro prints it: parents as initials, the basename whole, the full path on hover. */
function PathLabel({ cwd }: { cwd: string }) {
  const short = abbrevPath(cwd);
  const slash = short.lastIndexOf("/");
  return (
    <span className="min-w-0 truncate pl-1.5" aria-label="Working directory" title={cwd}>
      {slash >= 0 && <span className="text-ink-3">{short.slice(0, slash + 1)}</span>}
      <span className="text-ink">{short.slice(slash + 1)}</span>
    </span>
  );
}
