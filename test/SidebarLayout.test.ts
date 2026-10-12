import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSidebarLayout,
  SIDEBAR_WIDTH,
  type SidebarEnvironment,
} from "../web/src/lib/sidebarLayout.ts";

/** A focusable control on a fake page: it can be removed or hidden, and records focus. */
interface Control {
  name: string;
  available: boolean;
}

/** A page at a breakpoint, with storage and focus the test controls. */
function page({ desktop = true, stored = {} as Record<string, string> } = {}) {
  const storage = new Map(Object.entries(stored));
  const breakpoint = new Set<() => void>();
  let wide = desktop;
  let focused: Control | null = null;
  const env: SidebarEnvironment<Control> = {
    desktop: () => wide,
    onBreakpoint: (listener) => {
      breakpoint.add(listener);
      return () => breakpoint.delete(listener);
    },
    read: (key) => storage.get(key) ?? null,
    write: (key, value) => storage.set(key, value),
    focused: () => focused,
    canFocus: (control) => control.available,
    focus: (control) => {
      focused = control;
    },
  };
  const layout = createSidebarLayout(env);
  const stop = layout.start();
  return {
    layout,
    state: layout.getState,
    storage,
    stop,
    focus: (control: Control | null) => {
      focused = control;
    },
    focused: () => focused,
    resize: (next: boolean) => {
      wide = next;
      for (const listener of breakpoint) listener();
    },
  };
}

test("show, hide and toggle collapse the column on desktop and remember it", () => {
  const p = page();
  assert.equal(p.state().collapsed, false);
  p.layout.hide();
  assert.equal(p.state().collapsed, true);
  assert.equal(p.storage.get("piano.sidebar"), "hidden");
  p.layout.toggle();
  assert.equal(p.state().collapsed, false);
  p.layout.toggle();
  p.layout.show();
  assert.equal(p.state().collapsed, false);
  assert.equal(p.state().mobileOpen, false, "desktop never opens the sheet");
  assert.equal(page({ stored: { "piano.sidebar": "hidden" } }).state().collapsed, true);
});

test("show, hide and toggle open and close the sheet below the breakpoint, leaving the column alone", () => {
  const p = page({ desktop: false });
  p.layout.show();
  assert.equal(p.state().mobileOpen, true);
  p.layout.toggle();
  assert.equal(p.state().mobileOpen, false);
  p.layout.toggle();
  assert.equal(p.state().mobileOpen, true);
  p.layout.hide();
  assert.equal(p.state().mobileOpen, false);
  assert.equal(p.state().collapsed, false);
  assert.equal(p.storage.has("piano.sidebar"), false);
});

test("a remembered width is used only within bounds", () => {
  assert.equal(page({ stored: { "piano.sidebarWidth": "320" } }).state().width, 320);
  for (const bad of ["1000", "50", "wide"])
    assert.equal(
      page({ stored: { "piano.sidebarWidth": bad } }).state().width,
      SIDEBAR_WIDTH.default,
    );
});

test("resizing follows the pointer within bounds and remembers the width it ends at", () => {
  const p = page();
  const released: string[] = [];
  p.layout.startResize(288, () => released.push("released"));
  assert.equal(p.state().resizing, true);
  p.layout.resizeTo(700);
  assert.equal(p.state().width, SIDEBAR_WIDTH.max);
  p.layout.resizeTo(330);
  assert.equal(p.state().width, 330);
  p.layout.finishResize();
  assert.deepEqual(released, ["released"]);
  assert.deepEqual(p.state(), { collapsed: false, width: 330, resizing: false, mobileOpen: false });
  assert.equal(p.storage.get("piano.sidebarWidth"), "330");
  p.layout.resetWidth();
  assert.equal(p.state().width, SIDEBAR_WIDTH.default);
});

test("dragging below 160px collapses and keeps the remembered width", () => {
  const p = page({ stored: { "piano.sidebarWidth": "320" } });
  p.layout.startResize(320);
  p.layout.resizeTo(120);
  assert.equal(
    p.state().width,
    SIDEBAR_WIDTH.min,
    "the column stops at its minimum while dragging",
  );
  p.layout.finishResize();
  assert.equal(p.state().collapsed, true);
  assert.equal(p.state().width, 320);
  assert.equal(p.storage.get("piano.sidebarWidth"), "320");
  p.layout.show();
  assert.deepEqual(p.state(), { collapsed: false, width: 320, resizing: false, mobileOpen: false });
});

test("a cancelled resize, or a collapse during one, restores the remembered width", () => {
  const p = page();
  let released = 0;
  p.layout.startResize(288, () => released++);
  p.layout.resizeTo(400);
  p.layout.cancelResize();
  assert.equal(p.state().width, SIDEBAR_WIDTH.default);
  p.layout.startResize(288, () => released++);
  p.layout.resizeTo(400);
  p.layout.setCollapsed(true);
  assert.deepEqual(p.state(), {
    collapsed: true,
    width: SIDEBAR_WIDTH.default,
    resizing: false,
    mobileOpen: false,
  });
  p.layout.finishResize();
  assert.equal(released, 2);
  assert.equal(p.storage.has("piano.sidebarWidth"), false);
});

test("crossing the breakpoint closes the sheet and cancels a resize", () => {
  const p = page();
  let released = 0;
  p.layout.startResize(288, () => released++);
  p.layout.resizeTo(400);
  p.resize(false);
  assert.equal(p.state().resizing, false);
  assert.equal(p.state().width, SIDEBAR_WIDTH.default);
  assert.equal(released, 1);
  p.layout.show();
  assert.equal(p.state().mobileOpen, true);
  p.resize(true);
  assert.equal(p.state().mobileOpen, false);
  p.stop();
  p.resize(false);
  p.layout.show();
  p.resize(true);
  assert.equal(p.state().mobileOpen, true, "a stopped layout no longer follows the breakpoint");
});

test("closing the sheet returns focus to where it was, else to a visible show-sidebar control", () => {
  const p = page({ desktop: false });
  const composer: Control = { name: "composer", available: true };
  const hidden: Control = { name: "hidden page's button", available: false };
  const settings: Control = { name: "settings button", available: true };
  p.layout.registerFocusFallback(hidden);
  const unregister = p.layout.registerFocusFallback(settings);

  p.focus(composer);
  p.layout.show();
  p.focus(null); // the sheet takes focus
  p.layout.closeMobile();
  p.layout.restoreFocus();
  assert.equal(p.focused(), composer);

  p.layout.show();
  composer.available = false; // the control that had focus went away while the sheet was open
  p.layout.closeMobile();
  p.layout.restoreFocus();
  assert.equal(p.focused(), settings);

  // A swipe remembers focus as it starts revealing the sheet.
  composer.available = true;
  p.focus(composer);
  p.layout.previewMobile();
  p.layout.setMobileOpen(true);
  p.layout.setMobileOpen(false);
  p.layout.restoreFocus();
  assert.equal(p.focused(), composer);

  unregister();
  p.focus(null);
  p.layout.show();
  p.layout.closeMobile();
  p.layout.restoreFocus();
  assert.equal(p.focused(), null, "no visible control to fall back to");
});
