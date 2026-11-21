import { isWorking } from "@shared/features/sessions/sessionProjection";
import type { VoiceHints } from "@shared/features/voice-input/voiceInput";
import { cn } from "cn";
import { ArrowUpIcon, ChevronDownIcon, PencilIcon, SquareIcon } from "lucide-react";
import { useId } from "react";
import type { Client } from "@/app/client";
import type { SessionView } from "@/app/store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useModelCatalog } from "@/features/models/useModelCatalog";
import { useModelChoice } from "@/features/models/useModelChoice";
import {
  composerControl,
  DELIVERY,
  DELIVERY_MODES,
  type DeliveryMode,
  messageCommand,
  QUEUE_RESTORE_HINT,
  QUEUE_TEXT_ONLY,
  queuePanel,
  RESTORE_QUEUE,
  STOP,
} from "@/features/sessions/composer/composerControl";
import {
  ComposerSend,
  DraftEditor,
  useDraftEditor,
} from "@/features/sessions/composer/DraftEditor";
import type { DraftKey } from "@/features/sessions/composer/messageDraft";
import type { CompletionContext } from "@/features/sessions/composer/SlashTextarea";
import type { SessionNotice } from "@/features/sessions/sessionNotices";
import { ContextDetails } from "@/features/sessions/transcript/ContextDetails";
import { contextFigures } from "@/features/sessions/transcript/contextUsage";
import { JumpTo } from "@/features/sessions/transcript/JumpTo";
import type { TranscriptRow } from "@/features/sessions/transcript/transcript";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/components/PianoDropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/PianoTooltip";
import { Hint } from "@/shared/components/Shortcut";
import { createPreference } from "@/shared/lib/preference";
import { composerInput, footerPicker, footerPickerMenu } from "@/shared/lib/styles";
import { usePreference } from "@/shared/lib/usePreference";

interface Props {
  session: SessionView | null;
  history: ReadonlyArray<TranscriptRow>;
  draftKey: DraftKey | null;
  completion?: CompletionContext;
  place?: VoiceHints;
  disabled: boolean;
  actionsDisabled: boolean;
  readOnly?: SessionNotice;
  send: Client["send"];
}

const queueModePreference = createPreference<DeliveryMode>({
  key: "piano.queueMode",
  decode: (raw) => (raw === "follow-up" ? "follow-up" : "steering"),
  encode: (mode) => mode,
});

export function Composer({
  session: t,
  history,
  draftKey,
  completion,
  place,
  disabled,
  actionsDisabled,
  readOnly,
  send: sendCommand,
}: Props) {
  const directoryModels = useModelCatalog(t?.cwd);
  const models = actionsDisabled ? { ...directoryModels, refresh: undefined } : directoryModels;
  const { catalog } = models;
  const choice = useModelChoice(
    models,
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
    const { start } = choice;
    if (
      editor.submit((message, inputId) =>
        sendCommand(messageCommand(kind, message, start, inputId)),
      )
    )
      choice.consume();
  };
  const stop = () => sendCommand(STOP);
  const figures = contextFigures(usage?.context, catalog, choice.model);
  const queue = queuePanel(queuedMessages, streaming);
  const queueHintId = useId();

  if (readOnly) {
    return (
      <Alert className="mx-4 my-3 w-auto md:mx-6">
        <AlertTitle>{readOnly.title}</AlertTitle>
        <AlertDescription>{readOnly.details.join(" ")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      data-slot="session-composer"
      className="px-(--gutter) pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-3"
    >
      <DraftEditor
        editor={editor}
        completion={completion}
        disabled={disabled}
        label="Message"
        className="mx-auto w-full max-w-3xl"
        inputClassName={composerInput}
        maxHeight={192}
        model={choice}
        onSend={send}
        voice={() => place ?? {}}
        describedBy={queue ? queueHintId : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape" && control.escape) {
            e.preventDefault();
            if (control.escape === STOP) stop();
            else sendCommand(control.escape);
          }
        }}
        above={
          queue && (
            <section
              data-motion="fade"
              className="flex max-h-[min(14rem,30dvh)] flex-col border-b border-line px-4 py-3 text-sm"
              aria-label="Queued messages"
            >
              <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-1">
                <h2 className="font-medium text-ink-2">{queue.heading}</h2>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 shrink-0 compact:h-8"
                        aria-label={queue.editAriaLabel}
                        disabled={!control.canRestoreQueue}
                        onClick={() => {
                          sendCommand(RESTORE_QUEUE);
                          editor.ref.current?.focus();
                        }}
                      >
                        <PencilIcon data-icon="inline-start" aria-hidden />
                        {queue.editLabel}
                      </Button>
                    }
                  />
                  <TooltipContent>
                    <Hint of={["Esc"]}>{QUEUE_RESTORE_HINT}</Hint>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p id={queueHintId} className="mb-2 shrink-0 text-xs text-ink-3">
                {QUEUE_TEXT_ONLY}
              </p>
              <ol className="flex min-h-0 max-h-[min(9rem,20dvh)] flex-col gap-2 overflow-y-auto">
                {queuedMessages.map((message, index) => (
                  <li key={`${message.kind}-${index}`} className="flex min-w-0 flex-col gap-1">
                    {queue.showKinds && (
                      <span className="text-xs text-ink-3">
                        {message.kind === "steering" ? "Steering" : "Follow-up"}
                      </span>
                    )}
                    <span className="min-w-0 whitespace-pre-wrap break-words">{message.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          )
        }
        delivery={
          showDelivery && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    data-motion="fade"
                    variant="ghost"
                    size="sm"
                    className={cn(footerPicker, "shrink-0")}
                    aria-label={`Delivery: ${DELIVERY[queueMode].label}`}
                    disabled={disabled}
                  />
                }
              >
                {DELIVERY[queueMode].label}
                <ChevronDownIcon className="text-ink-3" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={cn("w-56", footerPickerMenu)}>
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
          )
        }
        actions={
          <ComposerSend
            face={showStop ? "neutral" : "primary"}
            className="relative"
            label={control.label}
            hint={control.hint}
            disabled={!control.enabled}
            onClick={showStop ? stop : () => send(false)}
          >
            <span
              aria-hidden
              data-motion="swap"
              className={cn(
                "absolute inset-0 grid place-items-center",
                showStop ? "scale-75 opacity-0 blur-[2px]" : "scale-100 opacity-100",
              )}
            >
              <ArrowUpIcon />
            </span>
            <span
              aria-hidden
              data-motion="swap"
              className={cn(
                "absolute inset-0 grid place-items-center",
                showStop ? "scale-100 opacity-100" : "scale-75 opacity-0 blur-[2px]",
              )}
            >
              <SquareIcon className="fill-current" />
            </span>
          </ComposerSend>
        }
      />
      <div className="mx-auto flex min-h-8 w-full max-w-3xl items-center gap-2 whitespace-nowrap font-mono text-xs text-ink-2 tabular-nums">
        <div
          className="ml-auto flex shrink-0 items-center gap-1 md:gap-2"
          role="group"
          aria-label="Session usage"
        >
          <JumpTo history={history} />
          <Popover>
            <PopoverTrigger
              render={
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
              }
            />
            <PopoverContent
              side="top"
              align="end"
              aria-label="Context usage details"
              className="w-96 max-w-[calc(100vw-2rem)] max-h-(--available-height) overflow-y-auto"
            >
              <ContextDetails figures={figures} usage={usage} messages={messages} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
