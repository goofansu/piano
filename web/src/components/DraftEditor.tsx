import type { Attachment, ModelCatalog, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  AttachButton,
  AttachmentDraftView,
  attachmentEvents,
  useAttachments,
} from "@/components/Attachments";
import { ModelSelect } from "@/components/ModelSelect";
import { type CompletionContext, SlashTextarea } from "@/components/SlashTextarea";
import { modelPickerAvailable } from "@/lib/composerControl";
import { useDraftStore } from "@/lib/draftStore";
import { isModelPickerKey, isSendKey } from "@/lib/keys";
import type { DraftKey } from "@/lib/messageDraft";
import { composerCard, composerToolbar } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { useAutoGrow } from "@/lib/useAutoGrow";

/** What a send takes from the draft: its text trimmed and its images. */
export interface DraftMessage {
  text: string;
  attachments: readonly Attachment[];
}

/**
 * One draft, addressed by its key (`null` while none is): its text from the draft store, its images,
 * the textarea it is edited in, and send-then-clear. A page calls this first so its own send rules
 * (see composerControl) can read the draft, then renders `DraftEditor` with the result.
 */
export function useDraftEditor(key: DraftKey | null) {
  const { drafts, change, append: appendTo } = useDraftStore();
  const text = (key && drafts[key]) || "";
  const attachments = useAttachments(key);
  const ref = useRef<HTMLTextAreaElement>(null);
  const setText = (value: string) => {
    if (key) change(key, value);
  };
  // Stable per key, so type-to-focus does not resubscribe on every keystroke.
  const append = useCallback(
    (value: string) => {
      if (key) appendTo(key, value);
    },
    [key, appendTo],
  );
  /** Hands the draft to `deliver`, then empties it. Callers decide beforehand whether it may send. */
  const submit = (deliver: (message: DraftMessage) => void) => {
    deliver({ text: text.trim(), attachments: attachments.items });
    setText("");
    attachments.clear();
  };
  return { key, text, attachments, ref, setText, append, submit };
}
export type DraftEditorState = ReturnType<typeof useDraftEditor>;

interface ModelProps {
  catalog: ModelCatalog | null;
  value: string | undefined;
  onChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  onRefresh?: () => void;
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
  const { ref, text, attachments } = editor;
  const [modelOpen, setModelOpen] = useState(false);
  useAutoGrow(ref, text, maxHeight);
  useTypeToFocus(ref, editor.append, !disabled);
  const pickerAvailable = modelPickerAvailable({
    disabled,
    catalog: model.catalog,
    canRefresh: !!model.onRefresh,
  });
  return (
    <div
      className={cn(composerCard, className)}
      {...attachmentEvents(attachments, attachmentsDisabled)}
    >
      <AttachmentDraftView draft={attachments} disabled={attachmentsDisabled} />
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
          } else onKeyDown?.(e);
        }}
      />
      <div className={composerToolbar}>
        <AttachButton draft={attachments} disabled={attachmentsDisabled} />
        <ModelSelect
          open={modelOpen}
          onOpenChange={setModelOpen}
          returnFocusRef={ref}
          catalog={model.catalog}
          onRefresh={model.onRefresh}
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
