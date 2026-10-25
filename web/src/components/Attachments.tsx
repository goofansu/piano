import { base64Bytes, IMAGE_TYPES } from "@shared/attachments";
import type { Attachment as AttachmentData, RenderMsg } from "@shared/wire";
import { ImageOffIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { IconButton } from "@/components/IconButton";
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
import { type DraftKey, drafts, type ImageDraft } from "@/lib/messageDraft";

/** Reads a file as base64 with the browser's native encoder. */
const encode = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}. Try again.`));
    reader.readAsDataURL(file);
  });
/** A draft's images (`null` while no draft is addressed) with the moves these controls offer; messageDraft owns them and their policy. */
export function attachmentDraft(key: DraftKey | null, images: ImageDraft) {
  return {
    ...images,
    add: (files: File[]) => drafts.addImages(key, files, encode),
    remove: (index: number) => drafts.removeImage(key, index),
  };
}
export type AttachmentDraft = ReturnType<typeof attachmentDraft>;

const TYPE_LABEL: Record<AttachmentData["mimeType"], string> = {
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/gif": "GIF",
  "image/webp": "WEBP",
};
const formatBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1048576).toFixed(1)} MB`
    : n >= 1024
      ? `${Math.round(n / 1024)} KB`
      : `${n} B`;

/** Native file input + shadcn controls; same validation for picker, drop and paste. */
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
        accept={IMAGE_TYPES.join(",")}
        className="hidden"
        aria-label="Image files"
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
        className="shrink-0"
        label="Attach images"
        tooltip="Attach images (PNG, JPEG, GIF, WebP)"
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
        <AttachmentGroup aria-label="Attachments" className="scroll-fade-none px-3 pt-3 font-sans">
          {draft.items.map((a, i) => (
            /* biome-ignore lint/suspicious/noArrayIndexKey: drafts may repeat a file name and only append or clear. */ <Attachment
              key={`${a.name}-${i}`}
              data-motion="enter"
              orientation="vertical"
            >
              <AttachmentMedia variant="image">
                <img src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{a.name}</AttachmentTitle>
                <AttachmentDescription>
                  {TYPE_LABEL[a.mimeType]} · {formatBytes(base64Bytes(a.data))}
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
                <AttachmentTitle>Reading images…</AttachmentTitle>
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
/** The drop target lights up while files hover over it (styled by `.composer-card[data-dragging]`). */
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
      <AttachmentTrigger asChild>
        <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          <span className="sr-only">Open attached image</span>
        </a>
      </AttachmentTrigger>
    </Attachment>
  );
}
/** The group clips overflow, so inline padding (offset by the margin) keeps the first tile's focus ring visible. */
export function MessageAttachments({ items }: { items: RenderMsg["attachments"] }) {
  return items?.length ? (
    <AttachmentGroup className="scroll-fade-none -mx-1 mt-2 px-1">
      {items.map((a, i) => (
        /* biome-ignore lint/suspicious/noArrayIndexKey: a message's attachments are fixed and may repeat a URL. */ <ImagePreview
          key={`${a.url}-${i}`}
          url={a.url}
        />
      ))}
    </AttachmentGroup>
  ) : null;
}
