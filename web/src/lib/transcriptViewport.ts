/**
 * Where the reader is in the transcript, and whether it follows new output. One viewport per
 * transcript: the transcript reports its scrolls, renders and resizes, and the jump list asks
 * where the reader is and moves them. A reader who scrolled up is never moved by new output; a
 * pinned reader stays on the bottom when content grows or the container shrinks, and a jump to
 * the end pins the reader there even if content grows while the scroll is in flight. The DOM is
 * read only through `ViewportElement`, so the policy runs in Node.
 */
import { type JumpEntry, messageAnchorId } from "./transcript.ts";

/** Within this many pixels of the bottom counts as at the bottom, and pins the view there. */
const NEAR_BOTTOM = 80;
/** Within this many pixels of the top counts as at the top. */
const NEAR_TOP = 40;
/** A message whose top is above this line under the container's top edge is the one being read. */
const READING_LINE = 80;
/** A jump lands a message this far under the container's top edge. */
const JUMP_MARGIN = 16;
const HIGHLIGHT_MS = 2200;

/** The transcript's scroll container, as the viewport sees it. */
export interface ViewportElement {
  readonly scrollHeight: number;
  scrollTop: number;
  readonly clientHeight: number;
  scrollTo: (options: { top: number; behavior: ScrollBehavior }) => void;
  /** A message's top edge relative to the container's top edge; `undefined` when it is not rendered. */
  anchorTop: (messageId: string) => number | undefined;
  /** Starts (restarting if running) or ends a message's highlight. */
  highlight: (messageId: string, on: boolean) => void;
}

/** Motion preference and timers, behind a seam so the policy runs in Node. */
export interface ViewportEnvironment {
  reducedMotion: () => boolean;
  setTimeout: (run: () => void, ms: number) => unknown;
}

export interface TranscriptViewport {
  /** The transcript's container mounted (a fresh view starts pinned) or unmounted (`null`). */
  attach: (element: ViewportElement | null) => void;
  /** The reader scrolled: pinned exactly when they ended near the bottom. */
  scrolled: () => void;
  /** The transcript re-rendered: a pinned view follows the bottom. */
  rendered: () => void;
  /**
   * The container or its content changed size. Content growing only changes whether the bottom is
   * in view; the container itself resizing is not the reader's doing, so a pinned view follows.
   */
  resized: (changed: { container: boolean }) => void;
  /** The bottom is in view; subscribe to hear when that changes. */
  atBottom: () => boolean;
  subscribe: (listener: () => void) => () => void;
  /**
   * Scrolls to an entry and flashes the message it lands on; `false` when there is nowhere to go.
   * Only the transcript moves: `scrollIntoView` would also scroll `main` on phones and leave the
   * composer sitting high.
   */
  jump: (entry: JumpEntry) => boolean;
  /** The entry the reader is looking at: bottom when there, top near the top, else the message under the top edge. */
  current: (entries: ReadonlyArray<JumpEntry>) => string;
}

export const browserViewportEnvironment: ViewportEnvironment = {
  reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  setTimeout: (run, ms) => window.setTimeout(run, ms),
};

/** The DOM container behind the seam; messages are found by their anchor id in its document. */
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
    highlight: (messageId, on) => {
      const el = anchor(messageId);
      if (!el) return;
      el.classList.remove("message-highlight");
      if (!on) return;
      // Reflow between remove and add so a repeated jump replays the animation.
      void el.offsetWidth;
      el.classList.add("message-highlight");
    },
  };
}

export function createTranscriptViewport(
  env: ViewportEnvironment = browserViewportEnvironment,
): TranscriptViewport {
  let element: ViewportElement | null = null;
  let stick = true;
  let bottom = true;
  const listeners = new Set<() => void>();

  const near = (el: ViewportElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
  const setBottom = (value: boolean) => {
    if (bottom === value) return;
    bottom = value;
    for (const listener of listeners) listener();
  };
  const follow = (el: ViewportElement) => {
    if (stick) el.scrollTop = el.scrollHeight;
  };
  const behavior = (): ScrollBehavior => (env.reducedMotion() ? "auto" : "smooth");

  return {
    attach: (el) => {
      element = el;
      if (!el) return;
      stick = true;
      setBottom(true);
    },
    scrolled: () => {
      if (!element) return;
      stick = near(element);
      setBottom(stick);
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
    jump: (entry) => {
      const el = element;
      if (!el) return false;
      if (entry.kind === "top" || entry.kind === "bottom") {
        if (entry.kind === "bottom") stick = true;
        el.scrollTo({ top: entry.kind === "top" ? 0 : el.scrollHeight, behavior: behavior() });
        return true;
      }
      const id = entry.messageId;
      const top = el.anchorTop(id);
      if (top === undefined) return false;
      el.scrollTo({ top: top + el.scrollTop - JUMP_MARGIN, behavior: behavior() });
      el.highlight(id, true);
      env.setTimeout(() => el.highlight(id, false), HIGHLIGHT_MS);
      return true;
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
