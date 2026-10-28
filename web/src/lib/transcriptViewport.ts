/**
 * Where the reader is in the transcript, and whether it follows new output. One viewport per
 * transcript: the transcript reports its scrolls, renders and resizes, and the jump list asks
 * where the reader is and moves them. A reader who scrolled up, by however little, is never moved
 * by new output; a pinned reader stays on the bottom when content grows or the container shrinks,
 * and a jump to the end pins the reader there even if content grows afterwards. The DOM is read
 * only through `ViewportElement`, so the policy runs in Node.
 */
import { type JumpEntry, messageAnchorId } from "./transcript.ts";

/** Within this many pixels of the bottom counts as at the bottom; scrolling down into it pins the view. */
const NEAR_BOTTOM = 80;
/** Within this many pixels of the bottom is the end itself, where the view is always pinned. */
const AT_END = 1;
/** Within this many pixels of the top counts as at the top. */
const NEAR_TOP = 40;
/** A message whose top is above this line under the container's top edge is the one being read. */
const READING_LINE = 80;
/** A jump lands a message this far under the container's top edge. */
export const TRANSCRIPT_JUMP_MARGIN = 16;
/** A wheel's `deltaMode` values: pixels, lines (`WheelEvent.DOM_DELTA_LINE`) or pages. */
const DELTA_LINE = 1;
const DELTA_PAGE = 2;
/** Pixels per wheel line, where the browser reports lines. */
const LINE_PX = 16;

/** The transcript's scroll container, as the viewport sees it. */
export interface ViewportElement {
  readonly scrollHeight: number;
  scrollTop: number;
  readonly clientHeight: number;
  scrollTo: (options: { top: number }) => void;
  /** A message's top edge relative to the container's top edge; `undefined` when it is not rendered. */
  anchorTop: (messageId: string) => number | undefined;
  /** Windowed transcripts locate an index, then refine the jump as its rows are measured. */
  jumpToMessage?: (messageId: string, animate: boolean) => boolean;
  jumpToEdge?: (edge: "top" | "bottom") => void;
}

export interface TranscriptViewport {
  /** The transcript's container mounted (a fresh view starts pinned) or unmounted (`null`). */
  attach: (element: ViewportElement | null) => void;
  /**
   * The reader scrolled: pinned when they reached the end, or moved down to near it. Any move up
   * short of the end unpins, so small steps up from the bottom are not undone by new output.
   */
  scrolled: () => void;
  /** Consume any pending reader scroll, then apply geometry compensation without changing intent. */
  correct: (move: () => void) => void;
  /**
   * A wheel turned elsewhere in the area, handed to the transcript: moves the reader by the
   * wheel's `deltaY` in its `deltaMode` units (pixels, lines, or pages of the container) and
   * applies the same policy as `scrolled`; nothing happens without a transcript. The browser then
   * reports the move as a scroll of its own, which `scrolled` sees as a repeated position and
   * leaves the decision alone.
   */
  wheel: (deltaY: number, deltaMode: number) => void;
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
   * Scrolls to an entry; `false` when there is nowhere to go.
   * Only the transcript moves: `scrollIntoView` would also scroll `main` on phones and leave the
   * composer sitting high.
   */
  jump: (entry: JumpEntry, options?: { animate: boolean }) => boolean;
  /**
   * A jump to this message has come to rest: its top sits at the jump margin, or the transcript
   * ended before the message could reach it. `false` while it is not rendered.
   */
  landed: (messageId: string) => boolean;
  /** The entry the reader is looking at: bottom when there, top near the top, else the message under the top edge. */
  current: (entries: ReadonlyArray<JumpEntry>) => string;
}

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
  };
}

/** Destination geometry varies by adapter; jump intent does not. */
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
  const listeners = new Set<() => void>();

  const near = (el: ViewportElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
  const atEnd = (el: ViewportElement) => el.scrollHeight - el.scrollTop - el.clientHeight < AT_END;
  const setBottom = (value: boolean) => {
    if (bottom === value) return;
    bottom = value;
    for (const listener of listeners) listener();
  };
  const follow = (el: ViewportElement) => {
    // Rendering or resize can precede a native scroll's event. Read that movement before
    // following output overwrites it; growth alone leaves scrollTop unchanged.
    if (el.scrollTop !== lastTop) scrolled();
    if (!stick) return;
    el.scrollTop = el.scrollHeight;
    lastTop = el.scrollTop;
  };

  // A scroll reported at the position already decided on (the browser's own event after a
  // handed wheel, or after a follow) keeps that decision; a move up from the bottom would
  // otherwise read as a move down to it.
  const scrolled = () => {
    if (!element) return;
    const top = element.scrollTop;
    if (top !== lastTop) {
      stick = atEnd(element) || (near(element) && top >= lastTop);
      lastTop = top;
    }
    setBottom(near(element));
  };

  return {
    attach: (el) => {
      element = el;
      if (!el) return;
      stick = true;
      lastTop = el.scrollTop;
      setBottom(true);
    },
    scrolled,
    correct: (move) => {
      // A native scroll's event can still be queued when a measurement changes geometry.
      // Observe that move before acknowledging the programmatic correction, not afterwards.
      scrolled();
      move();
      if (!element) return;
      lastTop = element.scrollTop;
      setBottom(near(element));
    },
    wheel: (deltaY, deltaMode) => {
      if (!element) return;
      const unit =
        deltaMode === DELTA_PAGE ? element.clientHeight : deltaMode === DELTA_LINE ? LINE_PX : 1;
      element.scrollTop = element.scrollTop + deltaY * unit;
      scrolled();
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
      // Consume older reader movement before choosing the explicit jump's intent. A virtual
      // adapter can synchronously call correct() while moving; it must not rediscover that
      // queued scroll and overwrite this decision. All destinations share this transaction.
      scrolled();
      const previous = stick;
      stick = entry.kind === "bottom"; // Unpin before mounting an earlier destination.
      const found = moveTo(el, entry, options?.animate ?? false);
      if (!found) stick = previous;
      lastTop = el.scrollTop;
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
