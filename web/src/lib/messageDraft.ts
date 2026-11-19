import type { Attachment, ServerMessage } from "@shared/wire";
import {
  attachmentsRefusal,
  base64Bytes,
  IMAGE_TYPE_LIST,
  imageType,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_IMAGE_BYTES,
  mebibytes,
} from "../../../shared/attachments.ts";
import { cutText } from "../../../shared/cutText.ts";
import { inputVerdictOf } from "../../../shared/inputVerdict.ts";
import { sessionKey } from "../../../shared/wire.ts";
import type { SendDisposition } from "./ws.ts";

export type DraftKey = string & { readonly __draft: unique symbol };

export const NEW_SESSION_DRAFT = "new-session" as DraftKey;
export const sessionDraftKey = (s: { cwd: string; sessionId: string | null }) =>
  sessionKey(s.cwd, s.sessionId ?? "") as DraftKey;

export const appendParagraph = (existing: string, text: string) =>
  `${existing}${existing.trim() ? "\n\n" : ""}${text}`;

export interface ImageDraft {
  items: readonly Attachment[];
  busy: boolean;
  error: string;
}

export const hasContent = (draft: { text: string; images: Pick<ImageDraft, "items"> }) =>
  draft.text.trim().length > 0 || draft.images.items.length > 0;
const heldBytes = (items: readonly Attachment[]) =>
  items.reduce((n, a) => n + base64Bytes(a.data), 0);
const overLimit = (items: readonly Attachment[]) =>
  attachmentsRefusal(items.length, heldBytes(items));
export const sendable = (draft: { text: string; images: Pick<ImageDraft, "items" | "busy"> }) =>
  !draft.images.busy && hasContent(draft) && !overLimit(draft.images.items);

export interface ImageCandidate {
  name: string;
  size: number;
  type: string;
  head: Uint8Array;
}
export const IMAGE_HEAD_BYTES = 12;

export type ImageCheck =
  | { ok: true; mimeTypes: Attachment["mimeType"][] }
  | { ok: false; reason: string };

export function checkImages(
  current: readonly Attachment[],
  files: readonly ImageCandidate[],
): ImageCheck {
  const refusal = attachmentsRefusal(
    current.length + files.length,
    heldBytes(current) + files.reduce((n, f) => n + f.size, 0),
  );
  if (refusal) return { ok: false, reason: refusal };
  const mimeTypes: Attachment["mimeType"][] = [];
  for (const file of files) {
    if (!file.size || file.size > MAX_IMAGE_BYTES)
      return {
        ok: false,
        reason: `${file.name}: choose an image up to ${mebibytes(MAX_IMAGE_BYTES)}.`,
      };
    const mimeType = imageType(file.head);
    if (!mimeType || (file.type && file.type !== mimeType))
      return {
        ok: false,
        reason: `${file.name}: use ${IMAGE_TYPE_LIST}. Other files aren't supported yet.`,
      };
    mimeTypes.push(mimeType);
  }
  return { ok: true, mimeTypes };
}

export const quoteText = (selected: string) =>
  selected
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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

export interface Draft {
  text: string;
  images: ImageDraft;
  quotes: readonly string[];
  preparing?: DraftMessage;
  prepareError?: string;
}

export interface DraftMessage {
  text: string;
  attachments: readonly Attachment[];
}

const NO_IMAGES: ImageDraft = { items: [], busy: false, error: "" };
export const EMPTY_DRAFT: Draft = { text: "", images: NO_IMAGES, quotes: [] };

export const draftMessage = (draft: Draft): DraftMessage => ({
  text: withQuotes(draft.quotes, draft.text.trim()),
  attachments: draft.images.items,
});

export interface DraftSource {
  listen: (listener: (message: ServerMessage) => void) => () => void;
  getState?: () => {
    selectionId: string | null;
    session: { cwd: string; sessionId: string | null } | null;
  };
}

export interface Drafts {
  get: (key: DraftKey | null) => Draft;
  subscribe: (listener: () => void) => () => void;
  message: (key: DraftKey | null) => DraftMessage;
  sendable: (key: DraftKey | null) => boolean;
  setText: (key: DraftKey | null, text: string) => void;
  append: (key: DraftKey | null, text: string) => void;
  paragraph: (key: DraftKey | null, text: string) => void;
  addImages: (
    key: DraftKey | null,
    files: readonly File[],
    encode: (file: File) => Promise<string>,
  ) => Promise<void>;
  removeImage: (key: DraftKey | null, index: number) => void;
  addQuote: (key: DraftKey | null, selected: string) => void;
  removeQuote: (key: DraftKey | null, index: number) => void;
  submit: (
    key: DraftKey | null,
    deliver: (message: DraftMessage, inputId: string) => SendDisposition,
  ) => boolean;
  follow: (source: DraftSource) => () => void;
  prepareSubmit: (
    key: DraftKey | null,
    deliver: (message: DraftMessage, inputId: string) => Promise<SendDisposition>,
  ) => Promise<boolean>;
}

const restore = (submitted: Draft, now: Draft): Draft => {
  const items = [...submitted.images.items, ...now.images.items];
  return {
    text: now.text.trim() ? appendParagraph(submitted.text, now.text) : submitted.text,
    images: { ...now.images, items, error: overLimit(items) || now.images.error },
    quotes: [...submitted.quotes, ...now.quotes.filter((q) => !submitted.quotes.includes(q))],
    preparing: now.preparing,
    prepareError: now.prepareError,
  };
};

const inputPrefix = () =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

export function createDrafts(): Drafts {
  const drafts = new Map<DraftKey, Draft>();
  const unconfirmed = new Map<string, { key: DraftKey; draft: Draft }>();
  const prefix = inputPrefix();
  let inputs = 0;
  const listeners = new Set<() => void>();
  const get = (key: DraftKey | null): Draft => (key && drafts.get(key)) || EMPTY_DRAFT;
  const update = (key: DraftKey | null, change: (draft: Draft) => Draft) => {
    if (!key) return;
    const before = get(key);
    const next = change(before);
    if (next === before) return;
    if (
      next.text ||
      next.quotes.length ||
      next.images !== NO_IMAGES ||
      next.preparing ||
      next.prepareError
    )
      drafts.set(key, next);
    else drafts.delete(key);
    for (const notify of listeners) notify();
  };
  const setImages = (key: DraftKey, images: ImageDraft) =>
    update(key, (d) => ({
      ...d,
      images: images.items.length || images.busy || images.error ? images : NO_IMAGES,
    }));
  const giveBack = (inputId: string, created: DraftKey | undefined) => {
    const refused = unconfirmed.get(inputId);
    unconfirmed.delete(inputId);
    if (!refused) return;
    const key = refused.key === NEW_SESSION_DRAFT && created ? created : refused.key;
    update(key, (now) => restore(refused.draft, now));
  };
  const sessionOf = (m: ServerMessage, source: DraftSource): DraftKey | undefined => {
    if (m._tag === "selected" || m._tag === "error")
      return m.cwd !== undefined && m.sessionId
        ? sessionDraftKey({ cwd: m.cwd, sessionId: m.sessionId })
        : undefined;
    if (m._tag !== "session") return undefined;
    const shown = source.getState?.();
    return shown?.selectionId === m.selectionId && shown.session?.sessionId
      ? sessionDraftKey(shown.session)
      : undefined;
  };
  const isSendable = (draft: Draft) =>
    !draft.preparing && sendable({ text: draftMessage(draft).text, images: draft.images });
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
            name: cutText(file.name, MAX_ATTACHMENT_NAME_LENGTH),
            mimeType: check.mimeTypes[i],
            data: await encode(file),
          });
        const items = [...get(key).images.items, ...added];
        setImages(key, { items, busy: false, error: overLimit(items) });
      } catch (e) {
        setImages(key, {
          ...get(key).images,
          busy: false,
          error: e instanceof Error ? e.message : "Could not read images.",
        });
      }
    },
    removeImage(key, index) {
      const { images } = get(key);
      if (!key || images.busy) return;
      const items = images.items.filter((_, i) => i !== index);
      const error = overLimit(items) || (overLimit(images.items) ? "" : images.error);
      setImages(key, { ...images, items, error });
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
      const inputId = `input-${prefix}-${++inputs}`;
      if (deliver(draftMessage(draft), inputId) === "not-sent") return false;
      unconfirmed.set(inputId, { key, draft });
      update(key, () => EMPTY_DRAFT);
      return true;
    },
    async prepareSubmit(key, deliver) {
      const draft = get(key);
      if (!key || !isSendable(draft)) return false;
      const inputId = `input-${prefix}-${++inputs}`;
      const message = draftMessage(draft);
      update(key, () => ({ ...EMPTY_DRAFT, preparing: message }));
      let disposition: SendDisposition = "not-sent";
      let error = "";
      try {
        disposition = await deliver(message, inputId);
      } catch (e) {
        error = e instanceof Error ? e.message : "Could not upload images. Try again.";
      }
      if (disposition !== "not-sent") unconfirmed.set(inputId, { key, draft });
      update(key, (now) => {
        const remaining = { ...now, preparing: undefined, prepareError: error };
        return disposition === "not-sent" ? restore(draft, remaining) : remaining;
      });
      return disposition !== "not-sent";
    },
    follow: (source) =>
      source.listen((m) => {
        const verdict = inputVerdictOf(m);
        if (verdict)
          if (verdict.outcome === "not_sent") giveBack(verdict.inputId, sessionOf(m, source));
          else unconfirmed.delete(verdict.inputId);
        else if (m._tag === "action_result" && m.result._tag === "queue_restored") {
          const restored = m.result.messages.map((message) => message.text).join("\n\n");
          if (restored) paragraph(sessionDraftKey(m), restored);
        }
      }),
  };
}
