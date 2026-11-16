import { type JumpEntry, messageAnchorId } from "./transcript.ts";

const NEAR_BOTTOM = 80;
const AT_END = 1;
const NEAR_TOP = 40;
const READING_LINE = 80;
export const TRANSCRIPT_JUMP_MARGIN = 16;
const DELTA_LINE = 1;
const DELTA_PAGE = 2;
const LINE_PX = 16;

export interface ViewportElement {
  readonly scrollHeight: number;
  scrollTop: number;
  readonly clientHeight: number;
  scrollTo: (options: { top: number }) => void;
  anchorTop: (messageId: string) => number | undefined;
  jumpToMessage?: (messageId: string, animate: boolean) => boolean;
  jumpToEdge?: (edge: "top" | "bottom") => void;
}

export interface FoldEdges {
  top: number;
  header: number;
}

export interface TranscriptViewport {
  attach: (element: ViewportElement | null) => void;
  scrolled: () => void;
  correct: (move: () => void) => void;
  wheel: (deltaY: number, deltaMode: number) => void;
  fold: (open: boolean, edges: () => FoldEdges | undefined) => void;
  rendered: () => void;
  resized: (changed: { container: boolean }) => void;
  atBottom: () => boolean;
  subscribe: (listener: () => void) => () => void;
  jump: (entry: JumpEntry, options?: { animate: boolean }) => boolean;
  landed: (messageId: string) => boolean;
  current: (entries: ReadonlyArray<JumpEntry>) => string;
}

export function domFoldEdges(fold: HTMLElement, header: HTMLElement): FoldEdges | undefined {
  const container = fold.closest<HTMLElement>('[data-slot="transcript"]');
  if (!container) return undefined;
  const edge = container.getBoundingClientRect().top;
  return {
    top: fold.getBoundingClientRect().top - edge,
    header: header.getBoundingClientRect().top - edge,
  };
}

export function domViewportElement(container: HTMLElement): ViewportElement {
  const anchor = (messageId: string) =>
    container.ownerDocument.getElementById(messageAnchorId(messageId));
  return {
    get scrollHeight() {
      return container.scrollHeight;
    },
    get scrollTop() {
      return container.scrollTop;
    },
    set scrollTop(top: number) {
      container.scrollTop = top;
    },
    get clientHeight() {
      return container.clientHeight;
    },
    scrollTo: (options) => container.scrollTo(options),
    anchorTop: (messageId) => {
      const el = anchor(messageId);
      return el
        ? el.getBoundingClientRect().top - container.getBoundingClientRect().top
        : undefined;
    },
  };
}

function moveTo(el: ViewportElement, entry: JumpEntry, animate: boolean): boolean {
  if (entry.kind === "top" || entry.kind === "bottom") {
    if (el.jumpToEdge) el.jumpToEdge(entry.kind);
    else el.scrollTo({ top: entry.kind === "top" ? 0 : el.scrollHeight });
    return true;
  }
  if (el.jumpToMessage) return el.jumpToMessage(entry.messageId, animate);
  const top = el.anchorTop(entry.messageId);
  if (top === undefined) return false;
  el.scrollTo({ top: top + el.scrollTop - TRANSCRIPT_JUMP_MARGIN });
  return true;
}

export function createTranscriptViewport(): TranscriptViewport {
  let element: ViewportElement | null = null;
  let stick = true;
  let bottom = true;
  let lastTop = 0;
  let lastHeight = 0;
  const listeners = new Set<() => void>();

  const near = (el: ViewportElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
  const atEnd = (el: ViewportElement) => el.scrollHeight - el.scrollTop - el.clientHeight < AT_END;
  const setBottom = (value: boolean) => {
    if (bottom === value) return;
    bottom = value;
    for (const listener of listeners) listener();
  };
  const note = (el: ViewportElement) => {
    lastTop = el.scrollTop;
    lastHeight = el.scrollHeight;
  };
  const follow = (el: ViewportElement) => {
    if (el.scrollTop !== lastTop) scrolled();
    if (!stick) return;
    el.scrollTop = el.scrollHeight;
    note(el);
  };

  const scrolled = () => {
    if (!element) return;
    const top = element.scrollTop;
    if (top !== lastTop) {
      const clamped = element.scrollHeight < lastHeight && top < lastTop && atEnd(element);
      if (!clamped) stick = atEnd(element) || (near(element) && top >= lastTop);
      lastTop = top;
    }
    lastHeight = element.scrollHeight;
    setBottom(near(element));
  };

  return {
    attach: (el) => {
      element = el;
      if (!el) return;
      stick = true;
      note(el);
      setBottom(true);
    },
    scrolled,
    correct: (move) => {
      scrolled();
      move();
      if (!element) return;
      note(element);
      setBottom(near(element));
    },
    wheel: (deltaY, deltaMode) => {
      if (!element) return;
      const unit =
        deltaMode === DELTA_PAGE ? element.clientHeight : deltaMode === DELTA_LINE ? LINE_PX : 1;
      element.scrollTop = element.scrollTop + deltaY * unit;
      scrolled();
    },
    fold: (open, edges) => {
      const el = element;
      if (!el) return;
      scrolled();
      if (open) {
        stick = false;
        return;
      }
      const fold = edges();
      if (!fold) return;
      const from = el.scrollTop;
      el.scrollTop = from + fold.top - Math.max(fold.header, 0);
      if (el.scrollTop !== from) stick = atEnd(el);
      note(el);
      setBottom(near(el));
    },
    rendered: () => {
      if (element) follow(element);
    },
    resized: ({ container }) => {
      if (!element) return;
      if (container) follow(element);
      setBottom(near(element));
    },
    atBottom: () => bottom,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    jump: (entry, options) => {
      const el = element;
      if (!el) return false;
      scrolled();
      const previous = stick;
      stick = entry.kind === "bottom";
      const found = moveTo(el, entry, options?.animate ?? false);
      if (!found) stick = previous;
      note(el);
      setBottom(near(el));
      return found;
    },
    landed: (messageId) => {
      if (!element) return false;
      const top = element.anchorTop(messageId);
      return top !== undefined && (Math.abs(top - TRANSCRIPT_JUMP_MARGIN) < 1 || atEnd(element));
    },
    current: (entries) => {
      const el = element;
      if (!el || near(el)) return "bottom";
      if (el.scrollTop <= NEAR_TOP) return "top";
      let current = "top";
      for (const entry of entries) {
        if (entry.kind !== "user" && entry.kind !== "assistant") continue;
        const top = el.anchorTop(entry.messageId);
        if (top !== undefined && top <= READING_LINE) current = entry.id;
      }
      return current;
    },
  };
}
