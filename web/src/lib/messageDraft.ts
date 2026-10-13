/**
 * A message the user has not sent yet, on the New page or for one session. Its text lives in the
 * store and its images in browser memory, both under one draft key; this module decides the keys,
 * which images a draft accepts, how text is appended as a paragraph, how quotes from the transcript
 * join the message and when a draft can be sent.
 * Image bytes never go to localStorage or the registry (INV-01). Nothing here depends on React.
 */
import type { Attachment } from "@shared/wire";
// Relative, not @shared: module tests load this file directly in Node.
import {
  base64Bytes,
  imageType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
} from "../../../shared/attachments.ts";

/** Identifies one draft; built only here, so a bare string cannot address one. */
export type DraftKey = string & { readonly __draft: unique symbol };

/** The New page's single draft. */
export const NEW_SESSION_DRAFT = "new-session" as DraftKey;
/** A session's draft. Paths are absolute, so no session key can equal the New page's. */
export const sessionDraftKey = (s: { cwd: string; sessionId: string | null }) =>
  `${s.cwd}\n${s.sessionId ?? ""}` as DraftKey;

/**
 * Appends text as a new paragraph. A draft with visible text gets a blank line before the
 * addition; a blank or whitespace-only draft gets none, so added text never starts with an empty
 * paragraph. The existing text is kept as typed.
 */
export const appendParagraph = (existing: string, text: string) =>
  `${existing}${existing.trim() ? "\n\n" : ""}${text}`;

export interface ImageDraft {
  items: readonly Attachment[];
  /** Files are being read; the draft takes no other change until they are. */
  busy: boolean;
  /** Why the last addition was refused; the images already accepted stay. */
  error: string;
}

/** The draft has something to send: visible text or an image. */
export const hasContent = (draft: { text: string; images: Pick<ImageDraft, "items"> }) =>
  draft.text.trim().length > 0 || draft.images.items.length > 0;
/** The draft has content and no image is still being read. */
export const sendable = (draft: { text: string; images: Pick<ImageDraft, "items" | "busy"> }) =>
  !draft.images.busy && hasContent(draft);

/** What a file says about itself before it is read in full: its first bytes are enough to recognize it. */
export interface ImageCandidate {
  name: string;
  /** Original file size in bytes. */
  size: number;
  /** The browser's MIME type; empty when it does not know. */
  type: string;
  /** At least the first 12 bytes. */
  head: Uint8Array;
}
export const IMAGE_HEAD_BYTES = 12;

export type ImageCheck =
  | { ok: true; mimeTypes: Attachment["mimeType"][] }
  | { ok: false; reason: string };

/**
 * Whether `files` may join a draft that already holds `current`, per docs/image-attachments.md:
 * at most four images and 20 MiB together, each non-empty, up to 10 MiB, with a PNG, JPEG, GIF
 * or WebP signature its declared type (if any) agrees with. All or none are accepted.
 */
export function checkImages(
  current: readonly Attachment[],
  files: readonly ImageCandidate[],
): ImageCheck {
  if (current.length + files.length > MAX_ATTACHMENTS)
    return { ok: false, reason: "Attach up to 4 images per message." };
  if (
    current.reduce((n, a) => n + base64Bytes(a.data), 0) + files.reduce((n, f) => n + f.size, 0) >
    MAX_ATTACHMENT_BYTES
  )
    return { ok: false, reason: "Images must total 20 MiB or less." };
  const mimeTypes: Attachment["mimeType"][] = [];
  for (const file of files) {
    if (!file.size || file.size > MAX_IMAGE_BYTES)
      return { ok: false, reason: `${file.name}: choose an image up to 10 MiB.` };
    const mimeType = imageType(file.head);
    if (!mimeType || (file.type && file.type !== mimeType))
      return {
        ok: false,
        reason: `${file.name}: use PNG, JPEG, GIF or WebP. Other files aren't supported yet.`,
      };
    mimeTypes.push(mimeType);
  }
  return { ok: true, mimeTypes };
}

const EMPTY: ImageDraft = { items: [], busy: false, error: "" };
const images = new Map<DraftKey, ImageDraft>();
const listeners = new Set<() => void>();
function put(key: DraftKey, value: ImageDraft) {
  if (value.items.length || value.busy || value.error) images.set(key, value);
  else images.delete(key);
  for (const notify of listeners) notify();
}

/** Each draft's images, kept in memory for this page load only; a reload discards them. */
export const imageDrafts = {
  get: (key: DraftKey | null): ImageDraft => (key && images.get(key)) || EMPTY,
  subscribe(notify: () => void) {
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  },
  /** Checks and reads `files` into the draft; `encode` returns a file's base64 content. */
  async add(key: DraftKey | null, files: readonly File[], encode: (file: File) => Promise<string>) {
    const before = imageDrafts.get(key);
    if (!key || !files.length || before.busy) return;
    put(key, { ...before, busy: true, error: "" });
    try {
      const candidates = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
          head: new Uint8Array(await f.slice(0, IMAGE_HEAD_BYTES).arrayBuffer()),
        })),
      );
      const check = checkImages(before.items, candidates);
      if (!check.ok) throw new Error(check.reason);
      const added: Attachment[] = [];
      for (const [i, file] of files.entries())
        added.push({
          kind: "image",
          name: file.name.slice(0, 255),
          mimeType: check.mimeTypes[i],
          data: await encode(file),
        });
      put(key, { items: [...before.items, ...added], busy: false, error: "" });
    } catch (e) {
      put(key, {
        ...before,
        busy: false,
        error: e instanceof Error ? e.message : "Could not read images.",
      });
    }
  },
  remove(key: DraftKey | null, index: number) {
    const draft = imageDrafts.get(key);
    if (key && !draft.busy)
      put(key, { ...draft, items: draft.items.filter((_, i) => i !== index) });
  },
  clear(key: DraftKey | null) {
    if (key && !imageDrafts.get(key).busy) put(key, EMPTY);
  },
};

/**
 * Text selected in the transcript as a quote: line breaks kept (list items stay separate lines),
 * runs of blank lines folded to one, trailing spaces and the ends trimmed. Empty when nothing is left.
 */
export const quoteText = (selected: string) =>
  selected
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The message a draft sends: each quote as its own Markdown blockquote, in order, then the typed text. */
export const withQuotes = (quotes: readonly string[], text: string) =>
  [
    ...quotes.map((quote) =>
      quote
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n"),
    ),
    text,
  ]
    .filter(Boolean)
    .join("\n\n");

const NO_QUOTES: readonly string[] = [];
const quotes = new Map<DraftKey, readonly string[]>();
const quoteListeners = new Set<() => void>();
function putQuotes(key: DraftKey, value: readonly string[]) {
  if (value.length) quotes.set(key, value);
  else quotes.delete(key);
  for (const notify of quoteListeners) notify();
}

/** Each draft's quotes, kept in memory for this page load only, like its images. */
export const quoteDrafts = {
  get: (key: DraftKey | null): readonly string[] => (key && quotes.get(key)) || NO_QUOTES,
  subscribe(notify: () => void) {
    quoteListeners.add(notify);
    return () => {
      quoteListeners.delete(notify);
    };
  },
  /** Adds `selected` as a quote; empty text and a quote the draft already holds are ignored. */
  add(key: DraftKey | null, selected: string) {
    const quote = quoteText(selected);
    const current = quoteDrafts.get(key);
    if (key && quote && !current.includes(quote)) putQuotes(key, [...current, quote]);
  },
  remove(key: DraftKey | null, index: number) {
    if (key)
      putQuotes(
        key,
        quoteDrafts.get(key).filter((_, i) => i !== index),
      );
  },
  clear(key: DraftKey | null) {
    if (key) putQuotes(key, NO_QUOTES);
  },
};
