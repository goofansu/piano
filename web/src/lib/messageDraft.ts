/**
 * A message the user has not sent yet, on the New page or for one session: its text, its images
 * and its quotes from the transcript, all kept here under one draft key. This module decides the
 * keys, which images a draft accepts, how text is appended as a paragraph, how quotes join the
 * message, when a draft can be sent, and that sending empties all three parts at once.
 * Drafts live in browser memory for this page load only; image bytes never go to localStorage or
 * the registry (INV-01). Nothing here depends on React.
 */
import type { Attachment, ServerMessage } from "@shared/wire";
// Relative, not @shared: module tests load this file directly in Node.
import {
  base64Bytes,
  imageType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
} from "../../../shared/attachments.ts";
import { sessionKey } from "../../../shared/wire.ts";
import type { SendDisposition } from "./ws.ts";

/** Identifies one draft; built only here, so a bare string cannot address one. */
export type DraftKey = string & { readonly __draft: unique symbol };

/** The New page's single draft. */
export const NEW_SESSION_DRAFT = "new-session" as DraftKey;
/** A session's draft. Paths are absolute, so no session key can equal the New page's. */
export const sessionDraftKey = (s: { cwd: string; sessionId: string | null }) =>
  sessionKey(s.cwd, s.sessionId ?? "") as DraftKey;

/**
 * Appends text as a new paragraph. A draft with visible text gets a blank line before the
 * addition; a blank or whitespace-only draft gets none, so added text never starts with an empty
 * paragraph. The existing text is kept as typed.
 */
export const appendParagraph = (existing: string, text: string) =>
  `${existing}${existing.trim() ? "\n\n" : ""}${text}`;

export interface ImageDraft {
  items: readonly Attachment[];
  /** Files are being read; the draft takes no other image change, and is not sent, until they are. */
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

/**
 * Text selected in the transcript as a quote: line breaks kept (list items stay separate lines),
 * runs of blank lines folded to one, trailing spaces and the ends trimmed. Empty when nothing is left.
 */
export const quoteText = (selected: string) =>
  selected
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
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

/** One draft's parts. A draft no one has touched is `EMPTY_DRAFT`. */
export interface Draft {
  text: string;
  images: ImageDraft;
  quotes: readonly string[];
}

/** What a send takes from the draft: its quotes and trimmed text as one message, and its images. */
export interface DraftMessage {
  text: string;
  attachments: readonly Attachment[];
}

const NO_IMAGES: ImageDraft = { items: [], busy: false, error: "" };
export const EMPTY_DRAFT: Draft = { text: "", images: NO_IMAGES, quotes: [] };

/** The message `draft` would send now. */
export const draftMessage = (draft: Draft): DraftMessage => ({
  text: withQuotes(draft.quotes, draft.text.trim()),
  attachments: draft.images.items,
});

/** The client to follow for restored queues; the page's `Client` is one. */
export interface DraftSource {
  listen: (listener: (message: ServerMessage) => void) => () => void;
}

/** Every draft on the page. A `null` key addresses no draft: reads are empty and changes do nothing. */
export interface Drafts {
  /** The draft's parts; the same object until one of them changes, so React can subscribe to it. */
  get: (key: DraftKey | null) => Draft;
  subscribe: (listener: () => void) => () => void;
  /** The message the draft would send now. */
  message: (key: DraftKey | null) => DraftMessage;
  /** The draft has text, a quote or an image to send, and no image is still being read. */
  sendable: (key: DraftKey | null) => boolean;
  setText: (key: DraftKey | null, text: string) => void;
  /** Adds text at the end as typed, e.g. a key pressed outside the editor. */
  append: (key: DraftKey | null, text: string) => void;
  /** Adds text as a new paragraph (see `appendParagraph`): Ask from Changes, an extension's suggestion. */
  paragraph: (key: DraftKey | null, text: string) => void;
  /** Checks and reads `files` into the draft; `encode` returns a file's base64 content. */
  addImages: (
    key: DraftKey | null,
    files: readonly File[],
    encode: (file: File) => Promise<string>,
  ) => Promise<void>;
  removeImage: (key: DraftKey | null, index: number) => void;
  /** Adds `selected` as a quote; empty text and a quote the draft already holds are ignored. */
  addQuote: (key: DraftKey | null, selected: string) => void;
  removeQuote: (key: DraftKey | null, index: number) => void;
  /**
   * Hands the draft to `deliver`. Known-unsent input stays intact and returns false, as does
   * an unsendable draft. Otherwise consumes all parts and returns true, even when delivery is
   * uncertain: socket acceptance is not remote acceptance, and input must never auto-replay.
   */
  submit: (key: DraftKey | null, deliver: (message: DraftMessage) => SendDisposition) => boolean;
  /** Appends each queue Pi hands back to its own session's draft as a paragraph; returns the stop function. */
  follow: (source: DraftSource) => () => void;
}

export function createDrafts(): Drafts {
  const drafts = new Map<DraftKey, Draft>();
  const listeners = new Set<() => void>();
  const get = (key: DraftKey | null): Draft => (key && drafts.get(key)) || EMPTY_DRAFT;
  const update = (key: DraftKey | null, change: (draft: Draft) => Draft) => {
    if (!key) return;
    const before = get(key);
    const next = change(before);
    if (next === before) return;
    if (next.text || next.quotes.length || next.images !== NO_IMAGES) drafts.set(key, next);
    else drafts.delete(key);
    for (const notify of listeners) notify();
  };
  const setImages = (key: DraftKey, images: ImageDraft) =>
    update(key, (d) => ({
      ...d,
      images: images.items.length || images.busy || images.error ? images : NO_IMAGES,
    }));
  const isSendable = (draft: Draft) =>
    sendable({ text: draftMessage(draft).text, images: draft.images });
  const paragraph = (key: DraftKey | null, text: string) =>
    update(key, (d) => ({ ...d, text: appendParagraph(d.text, text) }));

  return {
    get,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    message: (key) => draftMessage(get(key)),
    sendable: (key) => isSendable(get(key)),
    setText: (key, text) => update(key, (d) => (d.text === text ? d : { ...d, text })),
    append: (key, text) => update(key, (d) => (text ? { ...d, text: d.text + text } : d)),
    paragraph,
    async addImages(key, files, encode) {
      const before = get(key).images;
      if (!key || !files.length || before.busy) return;
      setImages(key, { ...before, busy: true, error: "" });
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
        // Nothing removes or sends images while they are read, so `before` is still the draft's.
        setImages(key, { items: [...before.items, ...added], busy: false, error: "" });
      } catch (e) {
        setImages(key, {
          ...before,
          busy: false,
          error: e instanceof Error ? e.message : "Could not read images.",
        });
      }
    },
    removeImage(key, index) {
      const { images } = get(key);
      if (key && !images.busy)
        setImages(key, { ...images, items: images.items.filter((_, i) => i !== index) });
    },
    addQuote(key, selected) {
      const quote = quoteText(selected);
      update(key, (d) =>
        quote && !d.quotes.includes(quote) ? { ...d, quotes: [...d.quotes, quote] } : d,
      );
    },
    removeQuote: (key, index) =>
      update(key, (d) =>
        index in d.quotes ? { ...d, quotes: d.quotes.filter((_, i) => i !== index) } : d,
      ),
    submit(key, deliver) {
      const draft = get(key);
      if (!key || !isSendable(draft)) return false;
      if (deliver(draftMessage(draft)) === "not-sent") return false;
      update(key, () => EMPTY_DRAFT);
      return true;
    },
    follow: (source) =>
      source.listen((m) => {
        if (m._tag !== "action_result" || m.result._tag !== "queue_restored") return;
        const restored = m.result.messages.map((message) => message.text).join("\n\n");
        if (restored) paragraph(sessionDraftKey(m), restored);
      }),
  };
}

/** The page's drafts; App follows the client with them so restored queues reach their drafts. */
export const drafts = createDrafts();
