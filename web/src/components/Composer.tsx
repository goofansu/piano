import type {
  Attachment,
  ModelCatalog,
  QueuedMessage,
  RenderMsg,
  ThinkingLevel,
} from "@shared/wire";
import { cn } from "cn";
import { ArrowUpIcon, ChevronDownIcon, PencilIcon, SquareIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  AttachButton,
  AttachmentDraftView,
  attachmentEvents,
  useAttachments,
} from "@/components/Attachments";
import { ContextDetails } from "@/components/ContextDetails";
import { JumpTo } from "@/components/JumpTo";
import { ModelSelect } from "@/components/ModelSelect";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { PickerRadioItem as DropdownMenuRadioItem } from "@/components/PickerRadioItem";
import { type CompletionContext, SlashTextarea } from "@/components/SlashTextarea";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  composerControl,
  DELIVERY,
  DELIVERY_MODES,
  type DeliveryMode,
} from "@/lib/composerControl";
import { contextFigures, type SessionUsage } from "@/lib/contextUsage";
import { isModelPickerKey, isSendKey } from "@/lib/keys";
import type { DraftKey } from "@/lib/messageDraft";
import { readStorage, writeStorage } from "@/lib/storage";
import { composerAction, composerCard, composerInput, composerToolbar, picker } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { useAutoGrow } from "@/lib/useAutoGrow";

interface Props {
  /** `null` while the session is loading; the composer is disabled then. */
  draftKey: DraftKey | null;
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
  usage?: SessionUsage;
  messages?: ReadonlyArray<RenderMsg>;
  queuedMessages?: ReadonlyArray<QueuedMessage>;
}

const QUEUE_MODE_KEY = "piano.queueMode";
const loadQueueMode = (): DeliveryMode =>
  readStorage(QUEUE_MODE_KEY) === "follow-up" ? "follow-up" : "steering";

/** The composer: a layer-1 card that lines up with the transcript column. */
export function Composer({
  draftKey,
  completion,
  text,
  onTextChange,
  onTextAppend,
  onRestoreQueue,
  disabled,
  streaming,
  compacting,
  onSend,
  onStop,
  stopping,
  catalog,
  onRefreshModels,
  model,
  onModelChange,
  effort,
  onEffortChange,
  usage,
  messages = [],
  queuedMessages = [],
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const attachments = useAttachments(draftKey);
  // The delivery mode is a sticky preference; the alternative always stays on Alt+Enter.
  const [queueMode, setQueueModeState] = useState<DeliveryMode>(loadQueueMode);
  const setQueueMode = (mode: DeliveryMode) => {
    setQueueModeState(mode);
    writeStorage(QUEUE_MODE_KEY, mode);
  };
  const control = composerControl({
    text,
    images: attachments,
    disabled,
    streaming,
    compacting: !!compacting,
    stopping: !!stopping,
    queued: queuedMessages.length,
    mode: queueMode,
  });
  const { imagesWaiting, showDelivery } = control;
  const showStop = control.primary === "stop";
  useAutoGrow(ref, text, 192);
  useTypeToFocus(ref, onTextAppend, !disabled);
  const send = (alt: boolean) => {
    const kind = control.delivery(alt);
    if (!kind) return;
    onSend(text.trim(), kind, attachments.items);
    onTextChange("");
    attachments.clear();
  };
  const figures = contextFigures(usage?.context, catalog, model);
  const showQueueKinds = queuedMessages.some((message) => message.kind === "steering");

  return (
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-6 md:pb-5">
      <div
        className={cn("mx-auto w-full max-w-3xl", composerCard)}
        {...attachmentEvents(attachments, disabled)}
      >
        <AttachmentDraftView draft={attachments} disabled={disabled} />
        {imagesWaiting && (
          <p
            role="status"
            className="animate-in px-4 pt-2 text-sm text-ink-2 fade-in-0 slide-in-from-top-1"
          >
            Images are ready. Wait for Pi to finish before sending.
          </p>
        )}
        {queuedMessages.length > 0 && (
          <section
            className="control-enter flex max-h-[min(14rem,30dvh)] flex-col border-b border-line px-4 py-3 text-sm"
            aria-label="Queued messages"
          >
            <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-1">
              <h2 className="font-medium text-ink-2">
                {streaming ? "Queued messages" : "Paused queue"} ({queuedMessages.length})
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 shrink-0 md:h-8"
                aria-label={
                  queuedMessages.length === 1 ? "Edit queued message" : "Edit all queued messages"
                }
                title="Move queued messages back to the draft without stopping Pi (Esc)"
                disabled={!control.canRestoreQueue}
                onClick={() => {
                  onRestoreQueue();
                  ref.current?.focus();
                }}
              >
                <PencilIcon data-icon="inline-start" aria-hidden />
                {queuedMessages.length === 1 ? "Edit" : "Edit all"}
              </Button>
            </div>
            <ol className="flex min-h-0 max-h-[min(9rem,20dvh)] flex-col gap-2 overflow-y-auto">
              {queuedMessages.map((message, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: queued messages carry no id and may repeat text.
                  key={`${message.kind}-${index}`}
                  className="flex min-w-0 animate-in flex-col gap-1 fade-in-0"
                >
                  {showQueueKinds && (
                    <span className="text-xs text-ink-3">
                      {message.kind === "steering" ? "Steering" : "Follow-up"}
                    </span>
                  )}
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
              if (
                isModelPickerKey(e) &&
                !disabled &&
                catalog &&
                (catalog.models.length > 0 || onRefreshModels)
              ) {
                e.preventDefault();
                setModelOpen(true);
              } else if (isSendKey(e)) {
                e.preventDefault();
                send(e.altKey);
              } else if (e.key === "Escape" && control.escape !== "none") {
                e.preventDefault();
                if (control.escape === "restore-queue") onRestoreQueue();
                else onStop();
              }
            }}
          />
        </div>
        <div className={composerToolbar}>
          <AttachButton draft={attachments} disabled={disabled} />
          <ModelSelect
            open={modelOpen}
            onOpenChange={setModelOpen}
            returnFocusRef={ref}
            catalog={catalog}
            onRefresh={onRefreshModels}
            value={model}
            onChange={onModelChange}
            effort={effort}
            onEffortChange={onEffortChange}
            disabled={disabled}
          />
          {showDelivery && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(picker, "control-enter shrink-0")}
                  aria-label={`Delivery: ${DELIVERY[queueMode].label}`}
                  disabled={disabled}
                >
                  {DELIVERY[queueMode].label}
                  <ChevronDownIcon className="text-ink-3" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuRadioGroup
                  value={queueMode}
                  onValueChange={(mode) => setQueueMode(mode as DeliveryMode)}
                >
                  {DELIVERY_MODES.map((mode) => (
                    <DropdownMenuRadioItem key={mode} value={mode}>
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {DELIVERY[mode].label}
                        <KbdGroup className="ml-auto">
                          {mode !== queueMode && <Kbd>Alt</Kbd>}
                          <Kbd>Enter</Kbd>
                        </KbdGroup>
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
                aria-label={control.label}
                disabled={!control.enabled}
                onClick={showStop ? onStop : () => send(false)}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-0 grid place-items-center transition-[opacity,transform] duration-(--dur-enter) ease-(--ease-enter)",
                    showStop ? "scale-75 opacity-0" : "scale-100 opacity-100",
                  )}
                >
                  <ArrowUpIcon />
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-0 grid place-items-center transition-[opacity,transform] duration-(--dur-enter) ease-(--ease-enter)",
                    showStop ? "scale-100 opacity-100" : "scale-75 opacity-0",
                  )}
                >
                  <SquareIcon className="fill-current" />
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {control.hint.lead} <Kbd>{control.hint.key}</Kbd>
              {control.hint.tail}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mx-auto flex min-h-8 w-full max-w-3xl items-center gap-2 whitespace-nowrap font-mono text-xs text-ink-2 tabular-nums">
        {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form semantics and min-content sizing to a row of status buttons. */}
        <div
          className="ml-auto flex shrink-0 items-center gap-2"
          role="group"
          aria-label="Session usage"
        >
          <JumpTo messages={messages} />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Context usage"
                aria-description={figures.description}
                className={cn(
                  "px-1.5 font-mono text-xs font-normal",
                  figures.low && "text-warning hover:text-warning",
                )}
              >
                {figures.label}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              aria-label="Context usage details"
              className="w-96 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto font-mono"
            >
              <ContextDetails figures={figures} usage={usage} messages={messages} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
