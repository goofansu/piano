import type { ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
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
import { QuoteChips, type QuoteDraft } from "@/components/Quotes";
import { type CompletionContext, SlashTextarea } from "@/components/SlashTextarea";
import { isModelPickerKey, isSendKey } from "@/lib/keys";
import { type DraftKey, type DraftMessage, draftMessage, drafts } from "@/lib/messageDraft";
import type { ModelCatalogView } from "@/lib/modelCatalogs";
import { modelPickerEnabled } from "@/lib/modelPicker";
import { composerCard, composerToolbar } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { useAutoGrow } from "@/lib/useAutoGrow";
import type { SendDisposition } from "@/lib/ws";

/**
 * One draft, addressed by its key (`null` while none is), bound to React: its parts from `drafts`,
 * the textarea it is edited in, and send-then-clear. A page calls this first so its own send rules
 * (see composerControl) can read the draft, then renders `DraftEditor` with the result.
 */
export function useDraftEditor(key: DraftKey | null) {
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.get(key));
  const ref = useRef<HTMLTextAreaElement>(null);
  // Stable per key, so type-to-focus does not resubscribe on every keystroke.
  const append = useCallback((value: string) => drafts.append(key, value), [key]);
  return {
    key,
    text: draft.text,
    /** The text a send delivers; send rules read this, not `text`, so quotes alone can be sent. */
    message: draftMessage(draft).text,
    attachments: attachmentDraft(key, draft.images),
    quotes: {
      items: draft.quotes,
      remove: (index: number) => drafts.removeQuote(key, index),
    } satisfies QuoteDraft,
    ref,
    setText: (value: string) => drafts.setText(key, value),
    append,
    /** Consumes the draft unless delivery is known-unsent; see `Drafts.submit`. */
    submit: (deliver: (message: DraftMessage) => SendDisposition) => drafts.submit(key, deliver),
  };
}
export type DraftEditorState = ReturnType<typeof useDraftEditor>;

interface ModelProps {
  /** The directory's catalog with its refresh and saved defaults (`useModelCatalog`). */
  models: ModelCatalogView;
  value: string | undefined;
  onChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  noDirectory?: boolean;
}

interface Props {
  editor: DraftEditorState;
  completion?: CompletionContext;
  /** The draft cannot be edited: the textarea, model picker and typing from the page are off. */
  disabled?: boolean;
  /** Attaching images is off; defaults to `disabled`. */
  attachmentsDisabled?: boolean;
  label: string;
  /** Shown while the draft is empty, where the page has no heading that says what to write. */
  placeholder?: string;
  inputClassName?: string;
  className?: string;
  /** The tallest the textarea grows, in pixels. */
  maxHeight: number;
  autoFocus?: boolean;
  model: ModelProps;
  /** The send key was pressed; `alt` with Alt held. The page decides whether and how it sends. */
  onSend: (alt: boolean) => void;
  /** Keys the editor does not handle itself (Mod+/ opens the model picker, Enter sends). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Between the attached images and the textarea. */
  above?: ReactNode;
  /** The toolbar's end, after the model picker: the page's send control and its options. */
  actions: ReactNode;
}

/** The composer card both the New page and a session use: images, the slash-completing textarea, attach and model controls. */
export function DraftEditor({
  editor,
  completion,
  disabled = false,
  attachmentsDisabled = disabled,
  label,
  placeholder,
  inputClassName,
  className,
  maxHeight,
  autoFocus,
  model,
  onSend,
  onKeyDown,
  above,
  actions,
}: Props) {
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
        placeholder={placeholder}
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
        <AttachButton draft={attachments} disabled={attachmentsDisabled} />
        <ModelSelect
          open={modelOpen}
          onOpenChange={setModelOpen}
          returnFocusRef={ref}
          models={model.models}
          value={model.value}
          onChange={model.onChange}
          effort={model.effort}
          onEffortChange={model.onEffortChange}
          disabled={disabled}
          noDirectory={model.noDirectory}
        />
        {actions}
      </div>
    </div>
  );
}
