import { isWorking } from "@shared/sessionProjection";
import type { ClientCommand } from "@shared/wire";
import { cn } from "cn";
import { ArrowUpIcon, ChevronDownIcon, PaperclipIcon, PencilIcon, SquareIcon } from "lucide-react";
import { ContextDetails } from "@/components/ContextDetails";
import { DraftEditor, useDraftEditor } from "@/components/DraftEditor";
import { JumpTo } from "@/components/JumpTo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { PickerRadioItem as DropdownMenuRadioItem } from "@/components/PickerRadioItem";
import type { CompletionContext } from "@/components/SlashTextarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  composerControl,
  DELIVERY,
  DELIVERY_MODES,
  type DeliveryMode,
  messageCommand,
  queuePanel,
  RESTORE_QUEUE,
  STOP,
} from "@/lib/composerControl";
import { contextFigures } from "@/lib/contextUsage";
import type { DraftKey } from "@/lib/messageDraft";
import { createPreference } from "@/lib/preference";
import type { SessionNotice } from "@/lib/sessionNotices";
import { composerAction, composerInput, picker } from "@/lib/styles";
import { useModelCatalog } from "@/lib/useModelCatalog";
import { useModelChoice } from "@/lib/useModelChoice";
import { usePreference } from "@/lib/usePreference";
import type { SessionView } from "@/store";

interface Props {
  /** The selected session; `null` while it loads. */
  session: SessionView | null;
  /** `null` while the session is loading; the composer is disabled then. */
  draftKey: DraftKey | null;
  completion?: CompletionContext;
  /** Local drafting is unavailable (for example, before a session has loaded). */
  disabled: boolean;
  /** The session cannot take input now; model picks stay local until the next send. */
  actionsDisabled: boolean;
  /** Shown in place of the composer, which keeps its draft-local model picks meanwhile. */
  readOnly?: SessionNotice;
  send: (m: ClientCommand) => void;
}

/** The delivery mode is a sticky preference; the alternative always stays on Alt+Enter. */
const queueModePreference = createPreference<DeliveryMode>({
  key: "piano.queueMode",
  decode: (raw) => (raw === "follow-up" ? "follow-up" : "steering"),
  encode: (mode) => mode,
});

/**
 * The composer: a layer-1 card that lines up with the transcript column. It owns the session's
 * input contract: which session actions sending, queueing, stopping and picking a model send.
 */
export function Composer({
  session: t,
  draftKey,
  completion,
  disabled,
  actionsDisabled,
  readOnly,
  send: sendCommand,
}: Props) {
  const directoryModels = useModelCatalog(t?.cwd);
  // Refreshing waits for the session to take input again.
  const models = actionsDisabled ? { ...directoryModels, refresh: undefined } : directoryModels;
  const { catalog } = models;
  // A running Pi owns the selection; a saved session's picks wait for its first prompt and
  // override only what was picked, so Pi restores the rest of its recorded selection.
  const choice = useModelChoice(
    catalog,
    {
      kind: "session",
      cwd: t?.cwd,
      sessionId: t?.sessionId,
      hosted: !!t?.hosted,
      model: t?.state.model,
      thinkingLevel: t?.state.thinkingLevel,
    },
    (action) => sendCommand({ _tag: "act", action }),
    !actionsDisabled,
  );
  const { model, effort, onModelChange, onEffortChange } = choice;
  const streaming = !!t && isWorking(t.state);
  const usage = t?.state;
  const messages = t?.messages ?? [];
  const queuedMessages = t?.state.queuedMessages ?? [];
  const editor = useDraftEditor(draftKey);
  const [queueMode, setQueueMode] = usePreference(queueModePreference);
  const control = composerControl({
    text: editor.message,
    images: editor.attachments,
    disabled: disabled || actionsDisabled,
    streaming,
    compacting: !!t?.state.isCompacting,
    stopping: !!t?.state.isStopping,
    queued: queuedMessages.length,
    mode: queueMode,
  });
  const { showDelivery } = control;
  const showStop = control.primary === "stop";
  const send = (alt: boolean) => {
    const kind = control.delivery(alt);
    if (!kind) return;
    editor.submit((message) => {
      sendCommand(messageCommand(kind, message, choice.start()));
      choice.submitted();
    });
  };
  const figures = contextFigures(usage?.context, catalog, model);
  const queue = queuePanel(queuedMessages, streaming);

  if (readOnly) {
    return (
      <Alert className="mx-4 my-3 w-auto md:mx-6">
        <AlertTitle>{readOnly.title}</AlertTitle>
        <AlertDescription>{readOnly.details.join(" ")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-6 md:pb-5">
      <DraftEditor
        editor={editor}
        completion={completion}
        disabled={disabled}
        label="Message"
        className="mx-auto w-full max-w-3xl"
        inputClassName={composerInput}
        maxHeight={192}
        model={{
          models,
          value: model,
          onChange: onModelChange,
          effort,
          onEffortChange,
        }}
        onSend={send}
        onKeyDown={(e) => {
          if (e.key === "Escape" && control.escape) {
            e.preventDefault();
            sendCommand(control.escape);
          }
        }}
        above={
          queue && (
            <section
              className="control-enter flex max-h-[min(14rem,30dvh)] flex-col border-b border-line px-4 py-3 text-sm"
              aria-label="Queued messages"
            >
              <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-1">
                <h2 className="font-medium text-ink-2">{queue.heading}</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 shrink-0 md:h-8"
                  aria-label={queue.editAriaLabel}
                  title="Move queued messages back to the draft without stopping Pi (Esc)"
                  disabled={!control.canRestoreQueue}
                  onClick={() => {
                    sendCommand(RESTORE_QUEUE);
                    editor.ref.current?.focus();
                  }}
                >
                  <PencilIcon data-icon="inline-start" aria-hidden />
                  {queue.editLabel}
                </Button>
              </div>
              <ol className="flex min-h-0 max-h-[min(9rem,20dvh)] flex-col gap-2 overflow-y-auto">
                {queuedMessages.map((message, index) => (
                  <li
                    key={message.id ?? `${message.kind}-${index}`}
                    className="flex min-w-0 animate-in flex-col gap-1 fade-in-0"
                  >
                    {queue.showKinds && (
                      <span className="text-xs text-ink-3">
                        {message.kind === "steering" ? "Steering" : "Follow-up"}
                      </span>
                    )}
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="min-w-0 whitespace-pre-wrap break-words">
                        {message.text}
                      </span>
                      {!!message.attachmentCount && (
                        <Badge
                          variant="secondary"
                          className="shrink-0"
                          aria-label={`${message.attachmentCount} ${message.attachmentCount === 1 ? "attachment" : "attachments"}`}
                        >
                          <PaperclipIcon data-icon="inline-start" aria-hidden />
                          {message.attachmentCount}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )
        }
        actions={
          <>
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
                  onClick={showStop ? () => sendCommand(STOP) : () => send(false)}
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
          </>
        }
      />
      <div className="mx-auto flex min-h-8 w-full max-w-3xl items-center gap-2 whitespace-nowrap font-mono text-xs text-ink-2 tabular-nums">
        {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form semantics and min-content sizing to a row of status buttons. */}
        <div
          className="ml-auto flex shrink-0 items-center gap-2"
          role="group"
          aria-label="Session usage"
        >
          <JumpTo messages={messages} working={streaming} />
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
