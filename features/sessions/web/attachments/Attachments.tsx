import type { Drafts, ImageDraft } from "@features/sessions/web/composer/messageDraft";
import { base64Bytes } from "@shared/session/attachments";
import type { RenderMsg } from "@shared/wire";
import { FileIcon, ImageOffIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "@/shared/components/IconButton";
import { composerIcon } from "@/shared/lib/styles";
import { wheelSideways } from "@/shared/lib/wheelSideways";
import type { DraftKey } from "@/shared/state/draftKey";
import { fileLabel, imageLabel } from "../../contracts/attachments.ts";

const encode = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}. Try again.`));
    reader.readAsDataURL(file);
  });
export function attachmentDraft(key: DraftKey | null, images: ImageDraft, store: Drafts) {
  return {
    ...images,
    add: (files: File[]) => store.addImages(key, files, encode),
    remove: (index: number) => store.removeImage(key, index),
  };
}
export type AttachmentDraft = ReturnType<typeof attachmentDraft>;

export function AttachButton({ draft, disabled }: { draft: AttachmentDraft; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <>
      <Input
        ref={input}
        id={id}
        type="file"
        multiple
        className="hidden"
        aria-label="Attachment files"
        disabled={disabled || draft.busy}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void draft.add(files);
        }}
      />
      <IconButton
        size="icon-sm"
        type="button"
        className={composerIcon}
        label="Attach files"
        tooltip="Attach images, DWG, PDF, or plain text"
        aria-controls={id}
        disabled={disabled || draft.busy}
        onClick={() => input.current?.click()}
      >
        <PaperclipIcon />
      </IconButton>
    </>
  );
}
export function AttachmentDraftView({
  draft,
  disabled,
}: {
  draft: AttachmentDraft;
  disabled: boolean;
}) {
  return (
    <>
      {(!!draft.items.length || draft.busy) && (
        <AttachmentGroup
          aria-label="Attachments"
          className="scroll-fade-none px-3 pt-3 font-sans"
          ref={wheelSideways}
        >
          {draft.items.map((a, i) => (
            <Attachment key={`${a.name}-${i}`} data-motion="enter" orientation="vertical">
              {a.kind === "image" ? (
                <AttachmentMedia variant="image">
                  <img src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} />
                </AttachmentMedia>
              ) : (
                <AttachmentMedia>
                  <FileIcon />
                </AttachmentMedia>
              )}
              <AttachmentContent>
                <AttachmentTitle>{a.name}</AttachmentTitle>
                <AttachmentDescription>
                  {a.kind === "image"
                    ? imageLabel(a.mimeType, base64Bytes(a.data))
                    : fileLabel(a.mimeType, base64Bytes(a.data))}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`Remove ${a.name}`}
                  disabled={disabled || draft.busy}
                  onClick={() => draft.remove(i)}
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
          {draft.busy && (
            <Attachment role="status" data-motion="enter" orientation="vertical" state="uploading">
              <AttachmentMedia>
                <Spinner />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>Reading attachments…</AttachmentTitle>
              </AttachmentContent>
            </Attachment>
          )}
        </AttachmentGroup>
      )}
      {draft.error && (
        <Alert data-motion="fade" variant="destructive" className="mx-3 mt-3 w-auto">
          <AlertDescription className="break-words">{draft.error}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
export function attachmentEvents(draft: AttachmentDraft, disabled: boolean) {
  const settle = (e: React.DragEvent<HTMLElement>) => {
    delete e.currentTarget.dataset.dragging;
  };
  return {
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = disabled ? "none" : "copy";
      if (!disabled) e.currentTarget.dataset.dragging = "true";
    },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
        settle(e);
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      settle(e);
      if (e.dataTransfer.files.length) {
        e.preventDefault();
        if (!disabled) void draft.add(Array.from(e.dataTransfer.files));
      }
    },
    onPaste: (e: React.ClipboardEvent) => {
      if (e.clipboardData.files.length) {
        e.preventDefault();
        if (!disabled) void draft.add(Array.from(e.clipboardData.files));
      }
    },
  };
}
function ImagePreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed)
    return (
      <Attachment state="error">
        <AttachmentMedia>
          <ImageOffIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>Attached image</AttachmentTitle>
          <AttachmentDescription>
            Preview unavailable. Reopen the session to reload it.
          </AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    );
  return (
    <Attachment orientation="vertical">
      <AttachmentMedia variant="image">
        <img src={url} alt="Attachment preview" loading="lazy" onError={() => setFailed(true)} />
      </AttachmentMedia>
      <AttachmentTrigger
        render={
          <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            <span className="sr-only">Open attached image</span>
          </a>
        }
      />
    </Attachment>
  );
}
export function MessageAttachments({ items }: { items: RenderMsg["attachments"] }) {
  return items?.length ? (
    <AttachmentGroup className="scroll-fade-none -mx-1 mt-2 px-1" ref={wheelSideways}>
      {items.map((a, i) => (
        <ImagePreview key={`${a.url}-${i}`} url={a.url} />
      ))}
    </AttachmentGroup>
  ) : null;
}
