import { useId, useRef, useState, useSyncExternalStore } from "react";
import { PaperclipIcon, XIcon } from "lucide-react";
import type { Attachment, RenderMsg } from "@shared/wire";
import { IMAGE_TYPES, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_ATTACHMENT_BYTES, base64Bytes, imageType } from "@shared/attachments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Memory-only drafts: do not put private image bytes in localStorage or the registry.
const empty: { items: readonly Attachment[]; busy: boolean; error: string } = { items: [], busy: false, error: "" };
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
      if (current.reduce((n, a) => n + base64Bytes(a.data), 0) + files.reduce((n, f) => n + f.size, 0) > MAX_ATTACHMENT_BYTES) throw new Error("Images must total 10 MiB or less.");
      const added: Attachment[] = [];
      for (const file of files) {
        if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: choose an image up to 5 MiB.`);
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

/** Native file input + shadcn controls; same validation for picker, drop and paste. */
export function AttachButton({ draft, disabled }: { draft: AttachmentDraft; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return <>
    <Input ref={input} id={id} type="file" multiple accept={IMAGE_TYPES.join(",")} className="hidden" aria-label="Image files" disabled={disabled || draft.busy}
      onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void draft.add(files); }} />
    <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 md:size-8" aria-label="Attach images" title="Attach images (PNG, JPEG, GIF, WebP)" aria-controls={id} disabled={disabled || draft.busy} onClick={() => input.current?.click()}><PaperclipIcon /></Button>
  </>;
}
export function AttachmentDraftView({ draft, disabled }: { draft: AttachmentDraft; disabled: boolean }) {
  return <>
    {!!draft.items.length && <ul aria-label="Attachments" className="flex max-h-36 gap-2 overflow-auto px-3 pt-3">
      {draft.items.map((a, i) => <li key={i} className="relative w-24 shrink-0 rounded-lg border border-line p-1">
        <img src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} className="h-16 w-full rounded object-cover" />
        <p className="truncate text-xs text-ink-2" title={a.name}>{a.name}</p>
        <Button type="button" size="icon-sm" variant="outline" className="absolute right-0 top-0 size-8 bg-fill" aria-label={`Remove ${a.name}`} disabled={disabled || draft.busy} onClick={() => draft.remove(i)}><XIcon /></Button>
      </li>)}
    </ul>}
    {draft.busy && <p role="status" className="px-4 pt-2 text-sm text-ink-2">Reading images…</p>}
    {draft.error && <p role="alert" className="px-4 pt-2 text-sm text-err">{draft.error}</p>}
  </>;
}
export function attachmentEvents(draft: AttachmentDraft, disabled: boolean) {
  return {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = disabled ? "none" : "copy"; } },
    onDrop: (e: React.DragEvent) => { if (e.dataTransfer.files.length) { e.preventDefault(); if (!disabled) void draft.add(Array.from(e.dataTransfer.files)); } },
    onPaste: (e: React.ClipboardEvent) => { if (e.clipboardData.files.length) { e.preventDefault(); if (!disabled) void draft.add(Array.from(e.clipboardData.files)); } },
  };
}
function ImagePreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="text-sm text-ink-2">Image preview unavailable. Reopen the session to reload it.</span>;
  return <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} aria-label="Open attached image"><img src={url} alt="Attached image" loading="lazy" className="max-h-48 max-w-full rounded-lg border border-line object-contain" onError={() => setFailed(true)} /></a>;
}
export function MessageAttachments({ items }: { items: RenderMsg["attachments"] }) {
  return items?.length ? <div className="mt-2 flex flex-wrap gap-2">{items.map((a, i) => <ImagePreview key={`${a.url}-${i}`} url={a.url} />)}</div> : null;
}
