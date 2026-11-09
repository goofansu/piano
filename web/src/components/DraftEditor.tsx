import type { VoiceHints } from "@shared/voiceInput";
import { cn } from "cn";
import { ArrowUpIcon } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AttachButton,
  AttachmentDraftView,
  attachmentDraft,
  attachmentEvents,
} from "@/components/Attachments";
import { ModelSelect } from "@/components/ModelSelect";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { QuoteChips, type QuoteDraft } from "@/components/Quotes";
import { type CompletionContext, SlashTextarea } from "@/components/SlashTextarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import type { ControlHint } from "@/lib/composerControl";
import { isModelPickerKey, isSendKey } from "@/lib/keys";
import { type DraftKey, type DraftMessage, draftMessage } from "@/lib/messageDraft";
import { modelPickerEnabled } from "@/lib/modelPicker";
import { composerAction, composerCard, composerToolbar } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { useAutoGrow } from "@/lib/useAutoGrow";
import { useDrafts, useOffers } from "@/lib/useMachine";
import type { ModelControl } from "@/lib/useModelChoice";
import type { SendDisposition } from "@/lib/ws";

/**
 * One draft, addressed by its key (`null` while none is), bound to React: its parts from `drafts`,
 * the textarea it is edited in, and send-then-clear. A page calls this first so its own send rules
 * (see composerControl) can read the draft, then renders `DraftEditor` with the result.
 */
export function useDraftEditor(key: DraftKey | null) {
  const drafts = useDrafts();
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.get(key));
  const ref = useRef<HTMLTextAreaElement>(null);
  // Stable per key, so type-to-focus does not resubscribe on every keystroke.
  const append = useCallback((value: string) => drafts.append(key, value), [drafts, key]);
  return {
    key,
    text: draft.text,
    preparing: draft.preparing,
    prepareError: draft.prepareError,
    prepareSubmit: (
      deliver: (message: DraftMessage, inputId: string) => Promise<SendDisposition>,
    ) => drafts.prepareSubmit(key, deliver),
    /** The text a send delivers; send rules read this, not `text`, so quotes alone can be sent. */
    message: draftMessage(draft).text,
    attachments: attachmentDraft(key, draft.images, drafts),
    quotes: {
      items: draft.quotes,
      remove: (index: number) => drafts.removeQuote(key, index),
    } satisfies QuoteDraft,
    ref,
    setText: (value: string) => drafts.setText(key, value),
    append,
    /** Consumes the draft unless delivery is known-unsent; see `Drafts.submit`. */
    submit: (deliver: (message: DraftMessage, inputId: string) => SendDisposition) =>
      drafts.submit(key, deliver),
  };
}
export type DraftEditorState = ReturnType<typeof useDraftEditor>;

interface Props {
  editor: DraftEditorState;
  completion?: CompletionContext;
  /** The draft cannot be edited: the textarea, model picker and typing from the page are off. */
  disabled?: boolean;
  /** Attaching images is off; defaults to `disabled`. */
  attachmentsDisabled?: boolean;
  label: string;
  inputClassName?: string;
  className?: string;
  /** The tallest the textarea grows, in pixels. */
  maxHeight: number;
  autoFocus?: boolean;
  /** The page's model picker (`useModelChoice`). */
  model: ModelControl;
  /** The send key was pressed; `alt` with Alt held. The page decides whether and how it sends. */
  onSend: (alt: boolean) => void;
  /** Keys the editor does not handle itself (Mod+/ opens the model picker, Enter sends). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Between the attached images and the textarea. */
  above?: ReactNode;
  /** The toolbar's end, after the model picker: the page's send control and its options. */
  actions: ReactNode;
  cancelUpload?: () => void;
  /**
   * Where the message is spoken, read when a recording stops: the names voice input spells by.
   * The mic shows beside Attach in every composer while voice input is on.
   */
  voice?: () => VoiceHints;
}

const noVoiceContext = (): VoiceHints => ({});

/** The composer card both the New page and a session use: images, the slash-completing textarea, attach and model controls. */
export function DraftEditor({
  editor,
  completion,
  disabled = false,
  attachmentsDisabled = disabled,
  label,
  inputClassName,
  className,
  maxHeight,
  autoFocus,
  model,
  onSend,
  onKeyDown,
  above,
  actions,
  voice,
  cancelUpload,
}: Props) {
  const offers = useOffers();
  const { ref, text, attachments, quotes } = editor;
  const [modelOpen, setModelOpen] = useState(false);
  useAutoGrow(ref, text, maxHeight);
  useTypeToFocus(ref, editor.append, !disabled);
  // A quote added from the transcript leaves the reader ready to type about it.
  const quoteCount = useRef(quotes.items.length);
  useEffect(() => {
    if (quotes.items.length > quoteCount.current && !disabled) ref.current?.focus();
    quoteCount.current = quotes.items.length;
  }, [quotes.items.length, disabled, ref]);
  // Mod+/ opens the picker exactly when its trigger could.
  const pickerAvailable = modelPickerEnabled({
    disabled,
    catalog: model.models.catalog,
    canRefresh: !!model.models.refresh,
  });
  return (
    <div
      data-motion="ring"
      className={cn(composerCard, className)}
      {...attachmentEvents(attachments, attachmentsDisabled || !offers.attachments)}
    >
      {editor.preparing && (
        <>
          <AttachmentDraftView
            draft={{
              items: editor.preparing.attachments,
              busy: false,
              error: "",
              add: async () => {},
              remove: () => {},
            }}
            disabled
          />
          <div
            role="status"
            className="flex items-center gap-2 px-3 pt-2 text-sm text-muted-foreground"
          >
            <Spinner /> Uploading images…
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelUpload}
              aria-label="Cancel image upload"
            >
              Cancel
            </Button>
          </div>
        </>
      )}
      {editor.prepareError && (
        <Alert variant="destructive" className="mx-3 mt-3 w-auto">
          <AlertDescription>{editor.prepareError}</AlertDescription>
        </Alert>
      )}
      <AttachmentDraftView draft={attachments} disabled={attachmentsDisabled} />
      <QuoteChips draft={quotes} disabled={disabled} />
      {above}
      <SlashTextarea
        ref={ref}
        completion={completion}
        autoFocus={autoFocus}
        value={text}
        disabled={disabled}
        rows={1}
        aria-label={label}
        className={inputClassName}
        onValueChange={editor.setText}
        onKeyDown={(e) => {
          if (isModelPickerKey(e) && pickerAvailable) {
            e.preventDefault();
            setModelOpen(true);
          } else if (isSendKey(e)) {
            e.preventDefault();
            onSend(e.altKey);
          } else if (e.key === "Backspace" && !text && quotes.items.length) {
            // An empty draft's Backspace takes back the last quote, as in a token field.
            e.preventDefault();
            quotes.remove(quotes.items.length - 1);
          } else onKeyDown?.(e);
        }}
      />
      <div className={composerToolbar}>
        {offers.attachments && <AttachButton draft={attachments} disabled={attachmentsDisabled} />}
        {offers.voiceInput && (
          <VoiceInputButton editor={editor} session={voice ?? noVoiceContext} disabled={disabled} />
        )}
        <ModelSelect
          open={modelOpen}
          onOpenChange={setModelOpen}
          returnFocusRef={ref}
          control={model}
          disabled={disabled}
        />
        {actions}
      </div>
    </div>
  );
}

const SEND_HINT: ControlHint = { lead: "Send", key: "Enter" };

/**
 * The composer's primary action, the toolbar's end in both composers: the button, with the key it
 * shares in a tooltip. The New page shows Send; a session passes its `composerControl` label and
 * hint, and its Send and Stop faces as `children` to cross-fade.
 */
export function ComposerSend({
  label = "Send",
  hint = SEND_HINT,
  disabled,
  onClick,
  variant,
  className,
  children = <ArrowUpIcon />,
}: {
  label?: string;
  hint?: ControlHint;
  disabled: boolean;
  onClick: () => void;
  variant?: "default" | "outline";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          data-motion="press"
          variant={variant}
          className={cn(composerAction, className)}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {hint.lead} <Kbd>{hint.key}</Kbd>
        {hint.tail}
      </TooltipContent>
    </Tooltip>
  );
}
