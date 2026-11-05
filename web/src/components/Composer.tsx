import { isWorking } from "@shared/sessionProjection";
import { cn } from "cn";
import { ArrowUpIcon, ChevronDownIcon, PencilIcon, SquareIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ContextDetails } from "@/components/ContextDetails";
import { DraftEditor, useDraftEditor } from "@/components/DraftEditor";
import { IconButton } from "@/components/IconButton";
import { JumpTo } from "@/components/JumpTo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import type { CompletionContext } from "@/components/SlashTextarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { Client } from "@/lib/client";
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
import {
  confirmDisclosure,
  draftNeedsReview,
  initialDisclosure,
  keepComposing,
  observeDraft,
} from "@/lib/composerDisclosure";
import { contextFigures } from "@/lib/contextUsage";
import { type Draft, type DraftKey, drafts } from "@/lib/messageDraft";
import { createPreference } from "@/lib/preference";
import type { SessionNotice } from "@/lib/sessionNotices";
import {
  composerAction,
  composerCard,
  composerInput,
  footerPicker,
  footerPickerMenu,
} from "@/lib/styles";
import { useModelCatalog } from "@/lib/useModelCatalog";
import { useModelChoice } from "@/lib/useModelChoice";
import { usePreference } from "@/lib/usePreference";
import type { SessionView } from "@/store";

interface Props {
  /** The selected session; `null` while it loads. */
  session: SessionView | null;
  /** The same available-width layout that hides the session rail. */
  single: boolean;
  /** `null` while the session is loading; the composer is disabled then. */
  draftKey: DraftKey | null;
  completion?: CompletionContext;
  /** Local drafting is unavailable (for example, before a session has loaded). */
  disabled: boolean;
  /** The session cannot take input now; model picks stay local until the next send. */
  actionsDisabled: boolean;
  /** Shown in place of the composer, which keeps its draft-local model picks meanwhile. */
  readOnly?: SessionNotice;
  send: Client["send"];
}

/** The delivery mode is a sticky preference; the alternative always stays on Alt+Enter. */
const queueModePreference = createPreference<DeliveryMode>({
  key: "piano.queueMode",
  decode: (raw) => (raw === "follow-up" ? "follow-up" : "steering"),
  encode: (mode) => mode,
});

/** The folded card's one line: the draft's first line of text, or its name while it holds only quotes or images. */
function draftPreview(draft: Draft): string | undefined {
  const line = draft.text.split("\n").find((l) => l.trim());
  if (line) return line.trim();
  return draftNeedsReview(draft) ? "Edit draft" : undefined;
}

/**
 * The composer: a layer-1 card that lines up with the transcript column. It owns the session's
 * input contract: which session actions sending, queueing, stopping and picking a model send.
 */
export function Composer({
  session: t,
  single,
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
  const [disclosure, setDisclosure] = useState(() => initialDisclosure(editor.draft));
  const [disclosureKey, setDisclosureKey] = useState(draftKey);
  const editorId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  // Feedback and queue actions stay visible; a nonempty working draft keeps its delivery controls.
  const blocked =
    queuedMessages.length > 0 ||
    editor.attachments.busy ||
    !!editor.attachments.error ||
    (streaming && draftNeedsReview(editor.draft));
  // Reset presentation, not the editor or its model-choice owner, on session navigation.
  const before = disclosureKey === draftKey ? disclosure : initialDisclosure(editor.draft);
  if (disclosureKey !== draftKey) setDisclosureKey(draftKey);
  const current = confirmDisclosure(
    observeDraft(before, editor.draft),
    t?.state.submission,
    !single || blocked,
  );
  if (current !== disclosure) setDisclosure(current);
  const expanded = !single || blocked || current.open;
  // A press or key after Send is newer intent, even if it lands in a portal or the transcript.
  // Never collapse asynchronously underneath that interaction.
  useEffect(() => {
    const keep = () => setDisclosure(keepComposing);
    document.addEventListener("pointerdown", keep, true);
    document.addEventListener("keydown", keep, true);
    return () => {
      document.removeEventListener("pointerdown", keep, true);
      document.removeEventListener("keydown", keep, true);
    };
  }, []);
  const wasExpanded = useRef(expanded);
  useLayoutEffect(() => {
    if (
      wasExpanded.current &&
      !expanded &&
      (document.activeElement === document.body ||
        surface.current?.contains(document.activeElement))
    )
      launcher.current?.focus({ preventScroll: true });
    wasExpanded.current = expanded;
  }, [expanded]);
  const changeOpen = (open: boolean) => {
    if (!open && blocked) return;
    // Commit the visible editor during activation so a phone may raise its keyboard.
    flushSync(() => setDisclosure({ open, draft: editor.draft }));
    (open ? editor.ref.current : launcher.current)?.focus({ preventScroll: true });
  };
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
    choice.submit((start) => {
      let submittedId: string | undefined;
      const consumed = editor.submit((message, inputId) => {
        submittedId = inputId;
        return sendCommand(messageCommand(kind, message, start, inputId));
      });
      if (consumed)
        setDisclosure({ open: true, draft: drafts.get(draftKey), pending: submittedId });
      return consumed;
    });
  };
  const figures = contextFigures(usage?.context, catalog, model);
  const preview = draftPreview(editor.draft);
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
    <div className="px-(--gutter) pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-3">
      <div ref={surface} className="mx-auto w-full max-w-3xl">
        {!expanded && (
          <div className="flex items-center gap-2">
            {/* The same card, folded to one row: the draft's first line waits where it was typed;
                an empty editor shows the launcher's name. The card's focus-within ring stands in
                for the button's own, as it does for the textarea. */}
            <div className={cn(composerCard, "flex min-w-0 flex-1")}>
              <Button
                ref={launcher}
                variant="ghost"
                aria-label={draftNeedsReview(editor.draft) ? "Edit draft" : "Compose"}
                aria-expanded={false}
                aria-controls={editorId}
                disabled={disabled}
                onClick={() => changeOpen(true)}
                className={cn(
                  "h-11 min-w-0 flex-1 justify-start gap-3 rounded-[inherit] px-4 text-base font-normal hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 md:h-10 md:px-5 md:text-sm",
                  preview ? "text-ink" : "text-ink-3 hover:text-ink-2",
                )}
              >
                <PencilIcon className="text-ink-3" aria-hidden />
                <span className="truncate">{preview ?? "Compose"}</span>
              </Button>
            </div>
            {showStop && (
              <IconButton
                size="icon"
                variant="outline"
                className={composerAction}
                label={control.label}
                disabled={!control.enabled}
                onClick={() => sendCommand(STOP)}
              >
                <SquareIcon className="fill-current" />
              </IconButton>
            )}
          </div>
        )}
        {/* Native hiding keeps the editor mounted without CollapsibleContent's animation
            measurements on every session mount; the transcript owns resize/scroll policy. */}
        <div
          id={editorId}
          hidden={!expanded}
          inert={!expanded}
          onFocusCapture={() => {
            // An empty desktop editor being used stays open if the available width shrinks.
            setDisclosure((state) => (state.open ? state : { ...state, open: true }));
          }}
        >
          <DraftEditor
            visible={expanded}
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
                  data-motion="fade"
                  className="flex max-h-[min(14rem,30dvh)] flex-col border-b border-line px-4 py-3 text-sm"
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
                        // Index keys: Pi queues carry only text, which may repeat.
                        key={`${message.kind}-${index}`}
                        className="flex min-w-0 flex-col gap-1"
                      >
                        {queue.showKinds && (
                          <span className="text-xs text-ink-3">
                            {message.kind === "steering" ? "Steering" : "Follow-up"}
                          </span>
                        )}
                        <span className="min-w-0 whitespace-pre-wrap break-words">
                          {message.text}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )
            }
            actions={
              <>
                {single && (
                  <IconButton
                    size="header"
                    label="Collapse composer"
                    aria-expanded={true}
                    aria-controls={editorId}
                    disabled={blocked}
                    onClick={() => changeOpen(false)}
                  >
                    <ChevronDownIcon />
                  </IconButton>
                )}
                {showDelivery && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        data-motion="fade"
                        variant="ghost"
                        size="sm"
                        className={cn(footerPicker, "shrink-0")}
                        aria-label={`Delivery: ${DELIVERY[queueMode].label}`}
                        disabled={disabled}
                      >
                        {DELIVERY[queueMode].label}
                        <ChevronDownIcon className="text-ink-3" aria-hidden />
                      </Button>
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
                )}
                {/* Send and Stop are one control; its face cross-fades so the key never jumps. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      data-motion="press"
                      variant={showStop ? "outline" : "default"}
                      className={cn(composerAction, "relative")}
                      aria-label={control.label}
                      disabled={!control.enabled}
                      onClick={showStop ? () => sendCommand(STOP) : () => send(false)}
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
        </div>
      </div>
      <div className="mx-auto flex min-h-8 w-full max-w-3xl items-center gap-2 whitespace-nowrap font-mono text-xs text-ink-2 tabular-nums">
        {/* role=group, not a <fieldset>: a <fieldset> brings form semantics and min-content sizing to a row of status buttons. */}
        <div
          className="ml-auto flex shrink-0 items-center gap-1 md:gap-2"
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
