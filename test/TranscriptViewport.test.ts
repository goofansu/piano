import assert from "node:assert/strict";
import { test } from "node:test";
import { BOTTOM_ENTRY, type JumpEntry } from "../web/src/lib/transcript.ts";
import {
  createTranscriptViewport,
  type ViewportElement,
} from "../web/src/lib/transcriptViewport.ts";

/** A scroll container like the browser's: scrollTop stays within [0, scrollHeight - clientHeight]. */
class FakeElement implements ViewportElement {
  #top = 0;
  /** Message tops measured from the content's top edge. */
  anchors = new Map<string, number>();
  scrollHeight: number;
  clientHeight: number;
  constructor(scrollHeight: number, clientHeight: number) {
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
  }
  get scrollTop() {
    return this.#top;
  }
  set scrollTop(top: number) {
    this.#top = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
  }
  scrollTo({ top }: { top: number }) {
    this.scrollTop = top;
  }
  anchorTop(id: string) {
    const top = this.anchors.get(id);
    return top === undefined ? undefined : top - this.scrollTop;
  }
}

const setup = ({ height = 2000, client = 500 } = {}) => {
  const viewport = createTranscriptViewport();
  const el = new FakeElement(height, client);
  viewport.attach(el);
  viewport.rendered();
  return { viewport, el };
};

/** The reader scrolls to `top`; the browser then reports the scroll. */
const scroll = (el: FakeElement, viewport: ReturnType<typeof setup>["viewport"], top: number) => {
  el.scrollTop = top;
  viewport.scrolled();
};

test("a pinned view follows the bottom as content grows", () => {
  const { viewport, el } = setup();
  assert.equal(el.scrollTop, 1500, "a new transcript opens on the bottom");
  el.scrollHeight = 2600;
  viewport.resized({ container: false });
  assert.equal(viewport.atBottom(), false, "growth alone only reveals that the bottom moved");
  viewport.rendered();
  assert.equal(el.scrollTop, 2100);
});

test("a reader who scrolled up is never moved by new output", () => {
  const { viewport, el } = setup();
  scroll(el, viewport, 1300);
  assert.equal(viewport.atBottom(), false);
  el.scrollHeight = 2600;
  viewport.resized({ container: false });
  viewport.rendered();
  assert.equal(el.scrollTop, 1300);
  assert.equal(viewport.atBottom(), false);
});

for (const update of ["render", "resize"] as const) {
  test(`${update} cannot overwrite a reader scroll whose event is still queued`, () => {
    for (const distance of [40, 300]) {
      const { viewport, el } = setup();
      const readingTop = el.scrollTop - distance;
      el.scrollTop = readingTop; // Native movement is immediate; its scroll event is deferred.
      el.scrollHeight += 600;
      if (update === "render") viewport.rendered();
      else {
        el.clientHeight = 300;
        viewport.resized({ container: true });
      }
      assert.equal(el.scrollTop, readingTop, "following must consume the pending move up");
      viewport.scrolled(); // The delayed event must not undo the decision either.
      el.scrollHeight += 600;
      viewport.rendered();
      assert.equal(el.scrollTop, readingTop, "later output leaves the reader in place");
      assert.equal(viewport.atBottom(), false);
    }
  });
}

test("a small step up from the bottom unpins the view, so new output does not undo it", () => {
  const { viewport, el } = setup();
  scroll(el, viewport, 1460);
  el.scrollHeight = 2600;
  viewport.rendered();
  assert.equal(el.scrollTop, 1460);
  scroll(el, viewport, 2100);
  el.scrollHeight = 2700;
  viewport.rendered();
  assert.equal(el.scrollTop, 2200, "reaching the end pins the view again");
});

test("scrolling back within 80px of the bottom pins the view again", () => {
  const { viewport, el } = setup();
  scroll(el, viewport, 1300);
  scroll(el, viewport, 1430);
  assert.equal(viewport.atBottom(), true);
  el.scrollHeight = 2600;
  viewport.rendered();
  assert.equal(el.scrollTop, 2100);
});

test("a shrinking container follows the bottom only while pinned", () => {
  const pinned = setup();
  pinned.el.clientHeight = 300;
  pinned.viewport.resized({ container: true });
  assert.equal(pinned.el.scrollTop, 1700);
  assert.equal(pinned.viewport.atBottom(), true);

  const reading = setup();
  scroll(reading.el, reading.viewport, 1000);
  reading.el.clientHeight = 300;
  reading.viewport.resized({ container: true });
  assert.equal(reading.el.scrollTop, 1000);
  assert.equal(reading.viewport.atBottom(), false);
});

test("atBottom subscribers hear only changes", () => {
  const { viewport, el } = setup();
  let heard = 0;
  const stop = viewport.subscribe(() => heard++);
  scroll(el, viewport, 1490);
  assert.equal(heard, 0);
  scroll(el, viewport, 1000);
  scroll(el, viewport, 900);
  assert.equal(heard, 1);
  stop();
  scroll(el, viewport, 1500);
  assert.equal(heard, 1);
});

test("a jump to the end re-pins a reader who had scrolled up, so new output follows", () => {
  const { viewport, el } = setup();
  scroll(el, viewport, 200);
  assert.equal(viewport.jump(BOTTOM_ENTRY), true);
  assert.equal(el.scrollTop, 1500);
  el.scrollHeight = 2600;
  viewport.resized({ container: false });
  viewport.rendered();
  assert.equal(el.scrollTop, 2100);
});

test("a jump to the top moves the reader there at once", () => {
  const { viewport, el } = setup();
  viewport.jump({ kind: "top", id: "top", label: "Top" });
  assert.equal(el.scrollTop, 0);
});

test("a jump to a message lands it 16px under the top edge", () => {
  const { viewport, el } = setup();
  el.anchors.set("u2", 900);
  const entry: JumpEntry = { kind: "user", id: "u2", label: "Second", messageId: "u2" };
  assert.equal(viewport.jump(entry), true);
  assert.equal(el.scrollTop, 884);
  assert.equal(
    viewport.jump({ kind: "user", id: "gone", label: "Gone", messageId: "gone" }),
    false,
    "a message that is not rendered goes nowhere",
  );
});

test("a message jump has landed at the margin, or at the end when the message cannot reach it", () => {
  const { viewport, el } = setup();
  el.anchors.set("u2", 900);
  el.anchors.set("last", 1900);
  scroll(el, viewport, 0);
  assert.equal(viewport.landed("u2"), false, "a message still below has not landed");
  el.scrollTop = 600; // Mid-flight, short of the margin.
  assert.equal(viewport.landed("u2"), false);
  viewport.jump({ kind: "user", id: "u2", label: "Second", messageId: "u2" });
  assert.equal(viewport.landed("u2"), true);
  viewport.jump({ kind: "user", id: "last", label: "Last", messageId: "last" });
  assert.equal(el.scrollTop, 1500, "the last message stops short of the margin at the end");
  assert.equal(viewport.landed("last"), true, "the end is as far as it can go");
  assert.equal(viewport.landed("gone"), false, "a message that is not rendered has not landed");
});

test("index jumps unpin before asynchronous mounting and refinement", () => {
  const { viewport, el } = setup();
  const virtual: ViewportElement = el;
  virtual.jumpToMessage = (id) => id === "offscreen";
  assert.equal(
    viewport.jump({ kind: "user", id: "offscreen", messageId: "offscreen", label: "Earlier" }),
    true,
  );
  el.scrollHeight = 3000;
  viewport.rendered();
  assert.equal(el.scrollTop, 1500, "rendering the destination must not follow the end");
  viewport.correct(() => {
    el.scrollTop = 800;
  });
  viewport.scrolled();
  viewport.rendered();
  assert.equal(el.scrollTop, 800);
});

test("explicit virtual jumps supersede native scrolls whose events are still queued", () => {
  const { viewport, el } = setup();
  const virtual: ViewportElement = el;
  virtual.jumpToEdge = () => viewport.correct(() => el.scrollTo({ top: el.scrollHeight }));
  virtual.jumpToMessage = () => {
    viewport.correct(() => el.scrollTo({ top: 800 }));
    return true;
  };

  el.scrollTop = 1200; // Pending move up, followed by an explicit request to follow the end.
  assert.equal(viewport.jump(BOTTOM_ENTRY), true);
  viewport.scrolled();
  el.scrollHeight = 2600;
  viewport.rendered();
  assert.equal(el.scrollTop, 2100, "the jump to the end wins over the earlier move up");

  scroll(el, viewport, 1000);
  el.scrollTop = 2100; // Pending arrival at the end, followed by a jump to an earlier message.
  assert.equal(
    viewport.jump({ kind: "user", id: "earlier", messageId: "earlier", label: "Earlier" }),
    true,
  );
  viewport.scrolled();
  el.scrollHeight = 3000;
  viewport.rendered();
  assert.equal(el.scrollTop, 800, "the message jump wins over the earlier arrival at the end");
});

test("a missing virtual destination preserves the reader's latest follow intent", () => {
  const { viewport, el } = setup();
  const virtual: ViewportElement = el;
  virtual.jumpToMessage = () => false;
  const missing: JumpEntry = { kind: "user", id: "gone", messageId: "gone", label: "Gone" };

  el.scrollTop = 1200; // The queued move up must not be lost when the lookup fails.
  assert.equal(viewport.jump(missing), false);
  el.scrollHeight = 2600;
  viewport.rendered();
  assert.equal(el.scrollTop, 1200);

  el.scrollTop = 2100; // Nor may a failed lookup unpin a reader who just reached the end.
  assert.equal(viewport.jump(missing), false);
  el.scrollHeight = 3000;
  viewport.rendered();
  assert.equal(el.scrollTop, 2500);
});

test("measurement compensation preserves follow intent in both directions", () => {
  const { viewport, el } = setup();
  viewport.correct(() => {
    el.scrollTop = 1400;
  });
  viewport.scrolled();
  el.scrollHeight = 3000;
  viewport.rendered();
  assert.equal(el.scrollTop, 2500, "a corrected pinned view still follows");
  scroll(el, viewport, 1800);
  viewport.correct(() => {
    el.scrollTop = 2500;
  });
  viewport.scrolled();
  el.scrollHeight = 3500;
  viewport.rendered();
  assert.equal(el.scrollTop, 2500, "correction near the end must not re-pin a reader");
});

test("measurement compensation cannot swallow a native scroll whose event is still queued", () => {
  const { viewport, el } = setup();
  el.scrollTop = 1200; // Reader moves up; ResizeObserver runs before the scroll event.
  viewport.correct(() => {
    el.scrollTop += 100;
  });
  viewport.scrolled();
  el.scrollHeight = 2600;
  viewport.rendered();
  assert.equal(el.scrollTop, 1300, "the pending move up must unpin");

  el.scrollTop = 2100; // Reader reaches the bottom, again before its event is dispatched.
  viewport.correct(() => {
    el.scrollTop -= 100;
  });
  viewport.scrolled();
  el.scrollHeight = 3000;
  viewport.rendered();
  assert.equal(el.scrollTop, 2500, "the pending arrival must pin before compensation");
});

test("a viewport without a transcript goes nowhere and reports the bottom", () => {
  const viewport = createTranscriptViewport();
  assert.equal(viewport.jump(BOTTOM_ENTRY), false);
  assert.equal(viewport.current([BOTTOM_ENTRY]), "bottom");
});

test("current is bottom near the end, top near the start, else the last message above the reading line", () => {
  const { viewport, el } = setup();
  el.anchors.set("u1", 100).set("a1", 700).set("u2", 1100);
  const entries: JumpEntry[] = [
    { kind: "top", id: "top", label: "Top" },
    { kind: "user", id: "u1", label: "First", messageId: "u1" },
    { kind: "assistant", id: "a1", label: "Reply", messageId: "a1" },
    { kind: "user", id: "u2", label: "Second", messageId: "u2" },
    BOTTOM_ENTRY,
  ];
  assert.equal(viewport.current(entries), "bottom");
  scroll(el, viewport, 1430);
  assert.equal(viewport.current(entries), "bottom", "within 80px of the end");
  scroll(el, viewport, 40);
  assert.equal(viewport.current(entries), "top", "within 40px of the start");
  scroll(el, viewport, 620);
  assert.equal(viewport.current(entries), "a1", "a1 sits exactly on the reading line");
  scroll(el, viewport, 619);
  assert.equal(viewport.current(entries), "u1", "a1 is 1px below the reading line");
  el.anchors.delete("u1");
  assert.equal(viewport.current(entries), "top", "nothing rendered above the line");
});

/** A wheel handed to the transcript; the browser then reports the move as a scroll of its own. */
const wheel = (viewport: ReturnType<typeof setup>["viewport"], deltaY: number, deltaMode = 0) => {
  viewport.wheel(deltaY, deltaMode);
  viewport.scrolled();
};

test("a wheel handed to the transcript moves the reader as a wheel on it would", () => {
  const { viewport, el } = setup();
  wheel(viewport, -40);
  assert.equal(el.scrollTop, 1460);
  assert.equal(viewport.atBottom(), true, "40px up is still near the bottom");
  el.scrollHeight = 2600;
  viewport.rendered();
  assert.equal(el.scrollTop, 1460, "a small step up is not undone by new output");
  wheel(viewport, -10, 1);
  assert.equal(el.scrollTop, 1300, "a line is 16px");
  wheel(viewport, -1, 2);
  assert.equal(el.scrollTop, 800, "a page is the container's height");
  wheel(viewport, 5000);
  assert.equal(el.scrollTop, 2100, "the container clamps the move at its end");
  assert.equal(viewport.atBottom(), true);
  el.scrollHeight = 2700;
  viewport.rendered();
  assert.equal(el.scrollTop, 2200, "landing at the end pins the view again");
  viewport.attach(null);
  viewport.wheel(100, 0);
  assert.equal(el.scrollTop, 2200, "without a transcript nothing moves");
});
