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
import { ComposerActionButton, type ComposerActionFace } from "@/components/ComposerActionButton";
import { ModelSelect } from "@/components/ModelSelect";
import { QuoteChips, type QuoteDraft } from "@/components/Quotes";
import { type CompletionContext, SlashTextarea } from "@/components/SlashTextarea";
import { Kbd } from "@/components/ui/kbd";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import type { ControlHint } from "@/lib/composerControl";
import { isModelPickerKey, isSendKey } from "@/lib/keys";
import { type DraftKey, type DraftMessage, draftMessage } from "@/lib/messageDraft";
import { modelPickerEnabled } from "@/lib/modelPicker";
import { composerCard, composerToolbar } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { useAutoGrow } from "@/lib/useAutoGrow";
import type { ModelControl } from "@/lib/useModelChoice";
import { useDrafts } from "@/lib/usePageStores";
import type { SendDisposition } from "@/lib/ws";

export function useDraftEditor(key: DraftKey | null) {
  const drafts = useDrafts();
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.get(key));
  const ref = useRef<HTMLTextAreaElement>(null);
  const append = useCallback((value: string) => drafts.append(key, value), [drafts, key]);
  return {
    key,
    text: draft.text,
    message: draftMessage(draft).text,
    attachments: attachmentDraft(key, draft.images, drafts),
    quotes: {
      items: draft.quotes,
      remove: (index: number) => drafts.removeQuote(key, index),
    } satisfies QuoteDraft,
    ref,
    setText: (value: string) => drafts.setText(key, value),
    append,
    submit: (deliver: (message: DraftMessage, inputId: string) => SendDisposition) =>
      drafts.submit(key, deliver),
  };
}
export type DraftEditorState = ReturnType<typeof useDraftEditor>;

interface Props {
  editor: DraftEditorState;
  completion?: CompletionContext;
  disabled?: boolean;
  attachmentsDisabled?: boolean;
  label: string;
  inputClassName?: string;
  className?: string;
  maxHeight: number;
  autoFocus?: boolean;
  model: ModelControl;
  onSend: (alt: boolean) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  describedBy?: string;
  above?: ReactNode;
  delivery?: ReactNode;
  actions: ReactNode;
  voice?: () => VoiceHints;
}

const noVoiceContext = (): VoiceHints => ({});

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
  describedBy,
  above,
  actions,
  delivery,
  voice,
}: Props) {
  const { ref, text, attachments, quotes } = editor;
  const [modelOpen, setModelOpen] = useState(false);
  useAutoGrow(ref, text, maxHeight);
  useTypeToFocus(ref, editor.append, !disabled);
  const quoteCount = useRef(quotes.items.length);
  useEffect(() => {
    if (quotes.items.length > quoteCount.current && !disabled) ref.current?.focus();
    quoteCount.current = quotes.items.length;
  }, [quotes.items.length, disabled, ref]);
  const pickerAvailable = modelPickerEnabled({
    disabled,
    catalog: model.models.catalog,
    canRefresh: !!model.models.refresh,
  });
  return (
    <div
      data-slot="draft-editor"
      data-motion="ring"
      className={cn(composerCard, className)}
      {...attachmentEvents(attachments, attachmentsDisabled)}
    >
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
        aria-describedby={describedBy}
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
            e.preventDefault();
            quotes.remove(quotes.items.length - 1);
          } else onKeyDown?.(e);
        }}
      />
      <div className={composerToolbar}>
        <AttachButton draft={attachments} disabled={attachmentsDisabled} />
        <ModelSelect
          open={modelOpen}
          onOpenChange={setModelOpen}
          returnFocusRef={ref}
          control={model}
          disabled={disabled}
        />
        {delivery}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <VoiceInputButton editor={editor} session={voice ?? noVoiceContext} disabled={disabled} />
          {actions}
        </div>
      </div>
    </div>
  );
}

const SEND_HINT: ControlHint = { lead: "Send", key: "Enter" };

export function ComposerSend({
  label = "Send",
  hint = SEND_HINT,
  disabled,
  onClick,
  face,
  className,
  children = <ArrowUpIcon />,
}: {
  label?: string;
  hint?: ControlHint;
  disabled: boolean;
  onClick: () => void;
  face?: ComposerActionFace;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <ComposerActionButton
      label={label}
      tooltip={
        <>
          {hint.lead} <Kbd>{hint.key}</Kbd>
          {hint.tail}
        </>
      }
      face={face}
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </ComposerActionButton>
  );
}
