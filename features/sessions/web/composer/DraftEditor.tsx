import {
  AttachButton,
  AttachmentDraftView,
  attachmentDraft,
  attachmentEvents,
} from "@features/sessions/web/attachments/Attachments";
import type { ControlHint } from "@features/sessions/web/composer/composerControl";
import { type DraftMessage, draftMessage } from "@features/sessions/web/composer/messageDraft";
import { QuoteChips, type QuoteDraft } from "@features/sessions/web/composer/Quotes";
import {
  type CompletionContext,
  SlashTextarea,
} from "@features/sessions/web/composer/SlashTextarea";
import { useDrafts } from "@features/sessions/web/composer/useDrafts";
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
import { Kbd } from "@/components/ui/kbd";
import {
  ComposerActionButton,
  type ComposerActionFace,
} from "@/shared/components/ComposerActionButton";
import { isModelPickerKey, isSendKey } from "@/shared/lib/keys";
import { composerCard, composerToolbar } from "@/shared/lib/styles";
import { type DraftKey } from "@/shared/state/draftKey";
import type { SendDisposition } from "../../../../shared/transport/ws.ts";
import { useTypeToFocus } from "./typeToFocus";
import { useAutoGrow } from "./useAutoGrow";

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

export interface EditorToolbar {
  pickerEnabled: boolean;
  renderModel: (props: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    returnFocusRef: DraftEditorState["ref"];
    disabled: boolean;
  }) => ReactNode;
  renderVoice: (editor: DraftEditorState, disabled: boolean) => ReactNode;
}

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
  toolbar: EditorToolbar;
  onSend: (alt: boolean) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  describedBy?: string;
  above?: ReactNode;
  delivery?: ReactNode;
  actions: ReactNode;
}

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
  toolbar,
  onSend,
  onKeyDown,
  describedBy,
  above,
  actions,
  delivery,
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
  const pickerAvailable = !disabled && toolbar.pickerEnabled;
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
        {toolbar.renderModel({
          open: modelOpen,
          onOpenChange: setModelOpen,
          returnFocusRef: ref,
          disabled,
        })}
        {delivery}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {toolbar.renderVoice(editor, disabled)}
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
