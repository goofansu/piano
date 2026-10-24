/**
 * The page's sidebar: on desktop a collapsible, resizable column whose state is remembered; below
 * the breakpoint a sheet revealed over the page. One controller owns the committed state
 * (collapsed, remembered width, sheet open), the transient resize drag, and where focus returns
 * when the sheet closes. Show, hide and toggle mean the right thing at either breakpoint, so
 * pages, the palette and keyboard shortcuts call them without knowing which applies. Pointer and
 * touch handling stay in the DOM; nothing here depends on React or the browser.
 */
import { readStorage, writeStorage } from "./storage.ts";

export const SIDEBAR_WIDTH = { min: 208, max: 480, default: 288, collapseBelow: 160 };
/** Where the sheet gives way to the column; matches Tailwind's `md`. */
export const DESKTOP_QUERY = "(min-width: 768px)";

const COLLAPSED_KEY = "piano.sidebar";
const WIDTH_KEY = "piano.sidebarWidth";

export interface SidebarLayoutState {
  /** The desktop column is hidden; each pane's header shows the control that brings it back. */
  collapsed: boolean;
  /** The expanded column's width: the remembered one, or the drag's while resizing. */
  width: number;
  /** A resize drag is in progress. */
  resizing: boolean;
  /** The sheet is open below the breakpoint. */
  mobileOpen: boolean;
}

/** The breakpoint, storage and focus, behind a seam so the policy runs in Node. */
export interface SidebarEnvironment<T> {
  desktop: () => boolean;
  /** Subscribes to crossing the breakpoint; returns the unsubscribe function. */
  onBreakpoint: (listener: () => void) => () => void;
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  focused: () => T | null;
  /** The target is still on the page and visible. */
  canFocus: (target: T) => boolean;
  focus: (target: T) => void;
}

export interface SidebarLayout<T = HTMLElement> {
  getState: () => SidebarLayoutState;
  subscribe: (listener: () => void) => () => void;
  /** Follows the breakpoint; returns the stop function, which also cancels a resize. */
  start: () => () => void;
  desktop: () => boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  /** The desktop column's state, as the stock sidebar shortcut sets it. */
  setCollapsed: (collapsed: boolean) => void;
  /** The sheet's committed state, as a swipe or its own dismissal sets it. */
  setMobileOpen: (open: boolean) => void;
  closeMobile: () => void;
  /** A swipe has started revealing the sheet: remember where focus was. */
  previewMobile: () => void;
  /** The sheet closed: focus where it was before it opened, else a visible show-sidebar control. */
  restoreFocus: () => void;
  /** A show-sidebar control offers itself as the focus fallback; returns the unregister function. */
  registerFocusFallback: (target: T) => () => void;
  /** Starts a resize from the column's current width; `release` runs when the drag ends either way. */
  startResize: (startWidth: number, release?: () => void) => void;
  /** The pointer's width, unclamped; the column follows it within bounds. */
  resizeTo: (width: number) => void;
  /** Commits the drag: below the collapse threshold it collapses and keeps the remembered width. */
  finishResize: () => void;
  cancelResize: () => void;
  resetWidth: () => void;
}

const clampWidth = (width: number) =>
  Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width));

export function createSidebarLayout<T>(env: SidebarEnvironment<T>): SidebarLayout<T> {
  const saved = Number(env.read(WIDTH_KEY));
  /** The committed width; the drag's lives in `drag`. */
  let width =
    saved >= SIDEBAR_WIDTH.min && saved <= SIDEBAR_WIDTH.max ? saved : SIDEBAR_WIDTH.default;
  let collapsed = env.read(COLLAPSED_KEY) === "hidden";
  let mobileOpen = false;
  let drag: { width: number; last: number; release: () => void } | null = null;
  let returnFocus: T | null = null;
  const fallbacks = new Set<T>();
  const listeners = new Set<() => void>();
  let state: SidebarLayoutState = { collapsed, width, resizing: false, mobileOpen };

  const publish = () => {
    const next: SidebarLayoutState = {
      collapsed,
      width: drag ? drag.width : width,
      resizing: drag !== null,
      mobileOpen,
    };
    if (
      next.collapsed === state.collapsed &&
      next.width === state.width &&
      next.resizing === state.resizing &&
      next.mobileOpen === state.mobileOpen
    )
      return;
    state = next;
    for (const listener of listeners) listener();
  };

  const endDrag = () => {
    const release = drag?.release;
    drag = null;
    release?.();
  };

  const cancelResize = () => {
    if (!drag) return;
    endDrag();
    publish();
  };

  const setCollapsed = (value: boolean) => {
    if (drag) endDrag();
    collapsed = value;
    env.write(COLLAPSED_KEY, value ? "hidden" : "shown");
    publish();
  };

  const setWidth = (value: number) => {
    width = value;
    env.write(WIDTH_KEY, String(value));
  };

  const capture = () => {
    returnFocus = env.focused();
  };

  const closeMobile = () => {
    mobileOpen = false;
    publish();
  };

  const show = () => {
    if (env.desktop()) setCollapsed(false);
    else {
      capture();
      mobileOpen = true;
      publish();
    }
  };

  const hide = () => {
    if (env.desktop()) setCollapsed(true);
    else closeMobile();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      const stop = env.onBreakpoint(() => {
        // Neither a drag nor an open sheet carries across the breakpoint.
        if (drag) endDrag();
        mobileOpen = false;
        publish();
      });
      return () => {
        stop();
        cancelResize();
      };
    },
    desktop: env.desktop,
    show,
    hide,
    toggle: () => {
      if (env.desktop()) setCollapsed(!collapsed);
      else if (mobileOpen) closeMobile();
      else show();
    },
    setCollapsed,
    setMobileOpen: (open) => (open ? show() : closeMobile()),
    closeMobile,
    previewMobile: capture,
    restoreFocus: () => {
      const target = returnFocus;
      returnFocus = null;
      if (target !== null && env.canFocus(target)) env.focus(target);
      else {
        const fallback = [...fallbacks].find(env.canFocus);
        if (fallback !== undefined) env.focus(fallback);
      }
    },
    registerFocusFallback: (target) => {
      fallbacks.add(target);
      return () => {
        fallbacks.delete(target);
      };
    },
    startResize: (startWidth, release = () => {}) => {
      if (drag) endDrag();
      drag = { width: startWidth, last: startWidth, release };
      publish();
    },
    resizeTo: (next) => {
      if (!drag) return;
      drag.last = next;
      drag.width = clampWidth(next);
      publish();
    },
    finishResize: () => {
      if (!drag) return;
      const { last } = drag;
      endDrag();
      // Dragged nearly shut: collapse, and expand again later at the width it had before.
      if (last < SIDEBAR_WIDTH.collapseBelow) setCollapsed(true);
      else {
        setWidth(clampWidth(last));
        publish();
      }
    },
    cancelResize,
    resetWidth: () => {
      setWidth(SIDEBAR_WIDTH.default);
      publish();
    },
  };
}

/** The real breakpoint, storage and focus. Globals are read only when called, so this module loads in Node. */
export const browserSidebarEnvironment: SidebarEnvironment<HTMLElement> = {
  desktop: () => matchMedia(DESKTOP_QUERY).matches,
  onBreakpoint: (listener) => {
    const media = matchMedia(DESKTOP_QUERY);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  },
  read: readStorage,
  write: writeStorage,
  focused: () => (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  canFocus: (target) => target.isConnected && target.checkVisibility({ visibilityProperty: true }),
  focus: (target) => target.focus({ preventScroll: true }),
};
