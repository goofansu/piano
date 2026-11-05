import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { browserSidebarEnvironment, createSidebarLayout } from "../web/src/lib/sidebarLayout.ts";
import { useNarrowViewport } from "../web/src/lib/useNarrowViewport.ts";
import { isWideViewport, subscribeViewport } from "../web/src/lib/viewportLayout.ts";

// The browser boundary supplies query results, including when rounded innerWidth disagrees.
// Real CSS/media-query evaluation is checked in the scratch browser, not reimplemented here.
function browser(t: TestContext) {
  let matches = true;
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return matches;
    },
    addEventListener: (event: string, listener: () => void) => {
      assert.equal(event, "change");
      listeners.add(listener);
    },
    removeEventListener: (event: string, listener: () => void) => {
      assert.equal(event, "change");
      listeners.delete(listener);
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 768,
      matchMedia: (query: string) => {
        assert.equal(query, "(min-width: 48rem)", "application reads CSS md's query");
        return media;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  return (next: boolean) => {
    if (matches === next) return;
    matches = next;
    for (const listener of listeners) listener();
  };
}

test("viewport observers and sidebar actions follow CSS's decision, not rounded pixels", (t) => {
  const cross = browser(t);
  const narrow: boolean[] = [];
  const stopObserver = subscribeViewport(() => narrow.push(!isWideViewport()));
  const layout = createSidebarLayout({
    ...browserSidebarEnvironment,
    read: () => null,
    write: () => {},
    focused: () => null,
  });
  const stopLayout = layout.start();

  // CSS oracle: at the default 16px baseline, 767 and 767.5 are narrow; 768 and 769 wide.
  // At a 20px browser baseline, 768 and 959.5 are narrow; 960 is wide.
  for (const [label, wide] of [
    ["16px / 769px", true],
    ["16px / 768px", true],
    ["16px / 767.5px", false],
    ["16px / 767px", false],
    ["16px / 768px again", true],
    ["20px / 768px", false],
    ["20px / 959.5px", false],
    ["20px / 960px", true],
  ] as const) {
    cross(wide);
    assert.equal(isWideViewport(), wide, label);
    assert.equal(layout.desktop(), wide, label);
    assert.equal(layout.getState().mobileOpen, false, "crossing closes a reveal");
    layout.show();
    assert.equal(layout.getState().mobileOpen, !wide, label);
    if (!wide) layout.hide();
  }
  assert.deepEqual(narrow, [true, false, true, false]);

  // A browser crossing cancels an active column resize without saving its transient width.
  layout.startResize(288);
  layout.resizeTo(400);
  cross(false);
  assert.equal(layout.getState().resizing, false);
  assert.equal(layout.getState().width, 288);
  layout.show();
  cross(true);
  assert.equal(layout.getState().mobileOpen, false);

  stopObserver();
  cross(false);
  layout.show();
  const observed = [...narrow];
  cross(true);
  assert.equal(layout.getState().mobileOpen, false, "one observer's cleanup leaves others live");
  assert.deepEqual(narrow, observed);
  stopLayout();
  cross(false);
  layout.show();
  cross(true);
  assert.equal(layout.getState().mobileOpen, true, "stopped layout no longer follows crossings");
});

test("header keeps its false first render before browser observation", () => {
  function HeaderMode() {
    return createElement("span", null, String(useNarrowViewport()));
  }
  assert.equal(renderToStaticMarkup(createElement(HeaderMode)), "<span>false</span>");
});
