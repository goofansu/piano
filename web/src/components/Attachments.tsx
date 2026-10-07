import { useId, useRef, useState, useSyncExternalStore } from "react";
import { ImageOffIcon, PaperclipIcon, XIcon } from "lucide-react";
import type { Attachment as AttachmentData, RenderMsg } from "@shared/wire";
import { IMAGE_TYPES, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_ATTACHMENT_BYTES, base64Bytes, imageType } from "@shared/attachments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentGroup, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

// Memory-only drafts: do not put private image bytes in localStorage or the registry.
const empty: { items: readonly AttachmentData[]; busy: boolean; error: string } = { items: [], busy: false, error: "" };
const drafts = new Map<string, typeof empty>();
const listeners = new Set<() => void>();
const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
export function useAttachments(key: string) {
  const state = useSyncExternalStore(subscribe, () => drafts.get(key) ?? empty);
  const set = (value: typeof empty) => {
    if (value.items.length || value.busy || value.error) drafts.set(key, value); else drafts.delete(key);
    listeners.forEach(notify => notify());
  };
  const add = async (files: File[]) => {
    const before = drafts.get(key) ?? empty;
    if (!files.length || before.busy) return;
    set({ ...before, busy: true, error: "" });
    try {
      const current = before.items;
      if (current.length + files.length > MAX_ATTACHMENTS) throw new Error("Attach up to 4 images per message.");
      if (current.reduce((n, a) => n + base64Bytes(a.data), 0) + files.reduce((n, f) => n + f.size, 0) > MAX_ATTACHMENT_BYTES) throw new Error("Images must total 20 MiB or less.");
      const added: AttachmentData[] = [];
      for (const file of files) {
        if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: choose an image up to 10 MiB.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mimeType = imageType(bytes);
        if (!mimeType || (file.type && file.type !== mimeType)) throw new Error(`${file.name}: use PNG, JPEG, GIF or WebP. Other files aren't supported yet.`);
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error(`Could not read ${file.name}. Try again.`));
          reader.readAsDataURL(file);
        });
        added.push({ kind: "image", name: file.name.slice(0, 255), mimeType, data });
      }
      set({ items: [...current, ...added], busy: false, error: "" });
    } catch (e) { set({ ...before, busy: false, error: e instanceof Error ? e.message : "Could not read images." }); }
  };
  return { ...state, add, remove: (index: number) => { if (!state.busy) set({ ...state, items: state.items.filter((_, i) => i !== index) }); }, clear: () => { if (!state.busy) set(empty); } };
}
export type AttachmentDraft = ReturnType<typeof useAttachments>;

const TYPE_LABEL: Record<AttachmentData["mimeType"], string> = { "image/png": "PNG", "image/jpeg": "JPG", "image/gif": "GIF", "image/webp": "WEBP" };
const formatBytes = (n: number) => n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

/** Native file input + shadcn controls; same validation for picker, drop and paste. */
export function AttachButton({ draft, disabled }: { draft: AttachmentDraft; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return <>
    <Input ref={input} id={id} type="file" multiple accept={IMAGE_TYPES.join(",")} className="hidden" aria-label="Image files" disabled={disabled || draft.busy}
      onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void draft.add(files); }} />
    <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label="Attach images" title="Attach images (PNG, JPEG, GIF, WebP)" aria-controls={id} disabled={disabled || draft.busy} onClick={() => input.current?.click()}><PaperclipIcon /></Button>
  </>;
}
export function AttachmentDraftView({ draft, disabled }: { draft: AttachmentDraft; disabled: boolean }) {
  return <>
    {(!!draft.items.length || draft.busy) && <AttachmentGroup aria-label="Attachments" className="px-3 pt-3 font-sans">
      {draft.items.map((a, i) => <Attachment key={`${a.name}-${i}`} orientation="vertical" className="animate-in fade-in-0 zoom-in-95">
        <AttachmentMedia variant="image"><img src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} /></AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle title={a.name}>{a.name}</AttachmentTitle>
          <AttachmentDescription>{TYPE_LABEL[a.mimeType]} · {formatBytes(base64Bytes(a.data))}</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction variant="outline" aria-label={`Remove ${a.name}`} disabled={disabled || draft.busy} onClick={() => draft.remove(i)}><XIcon /></AttachmentAction>
        </AttachmentActions>
      </Attachment>)}
      {draft.busy && <Attachment role="status" orientation="vertical" state="uploading" className="animate-in fade-in-0">
        <AttachmentMedia><Spinner /></AttachmentMedia>
        <AttachmentContent><AttachmentTitle>Reading images…</AttachmentTitle></AttachmentContent>
      </Attachment>}
    </AttachmentGroup>}
    {draft.error && <Alert variant="destructive" className="mx-3 mt-3 w-auto animate-in fade-in-0 slide-in-from-top-1"><AlertDescription className="break-words">{draft.error}</AlertDescription></Alert>}
  </>;
}
/** The drop target lights up while files hover over it (styled by `.composer-card[data-dragging]`). */
export function attachmentEvents(draft: AttachmentDraft, disabled: boolean) {
  const settle = (e: React.DragEvent<HTMLElement>) => { delete e.currentTarget.dataset.dragging; };
  return {
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = disabled ? "none" : "copy";
      if (!disabled) e.currentTarget.dataset.dragging = "true";
    },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) settle(e); },
    onDrop: (e: React.DragEvent<HTMLElement>) => { settle(e); if (e.dataTransfer.files.length) { e.preventDefault(); if (!disabled) void draft.add(Array.from(e.dataTransfer.files)); } },
    onPaste: (e: React.ClipboardEvent) => { if (e.clipboardData.files.length) { e.preventDefault(); if (!disabled) void draft.add(Array.from(e.clipboardData.files)); } },
  };
}
function ImagePreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <Attachment state="error">
    <AttachmentMedia><ImageOffIcon /></AttachmentMedia>
    <AttachmentContent><AttachmentTitle>Attached image</AttachmentTitle><AttachmentDescription>Preview unavailable. Reopen the session to reload it.</AttachmentDescription></AttachmentContent>
  </Attachment>;
  return <Attachment orientation="vertical">
    <AttachmentMedia variant="image"><img src={url} alt="Attached image" loading="lazy" onError={() => setFailed(true)} /></AttachmentMedia>
    <AttachmentTrigger asChild><a href={url} target="_blank" rel="noreferrer" aria-label="Open attached image" onClick={e => e.stopPropagation()} /></AttachmentTrigger>
  </Attachment>;
}
/** Inline padding keeps the first tile's edge and focus ring inside the group's scroll-fade mask. */
export function MessageAttachments({ items }: { items: RenderMsg["attachments"] }) {
  return items?.length ? <AttachmentGroup className="-mx-1 mt-2 px-1">{items.map((a, i) => <ImagePreview key={`${a.url}-${i}`} url={a.url} />)}</AttachmentGroup> : null;
}
