import { readStorage, writeStorage } from "./storage.ts";
import { isWideViewport, subscribeViewport } from "./viewportLayout.ts";

export const SIDEBAR_WIDTH = { min: 208, max: 480, default: 288, collapseBelow: 160 };

const COLLAPSED_KEY = "piano.sidebar";
const WIDTH_KEY = "piano.sidebarWidth";

export interface SidebarLayoutState {
  collapsed: boolean;
  width: number;
  resizing: boolean;
  mobileOpen: boolean;
}

export interface SidebarEnvironment<T> {
  desktop: () => boolean;
  onBreakpoint: (listener: () => void) => () => void;
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  focused: () => T | null;
  canFocus: (target: T) => boolean;
  focus: (target: T) => void;
}

export interface SidebarLayout<T = HTMLElement> {
  getState: () => SidebarLayoutState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  desktop: () => boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setMobileOpen: (open: boolean) => void;
  closeMobile: () => void;
  previewMobile: () => void;
  restoreFocus: () => void;
  registerFocusFallback: (target: T) => () => void;
  startResize: (startWidth: number, release?: () => void) => void;
  resizeTo: (width: number) => void;
  finishResize: () => void;
  cancelResize: () => void;
  resetWidth: () => void;
}

const clampWidth = (width: number) =>
  Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width));

export function createSidebarLayout<T>(env: SidebarEnvironment<T>): SidebarLayout<T> {
  const saved = Number(env.read(WIDTH_KEY));
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
    if (!env.desktop()) return;
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

export const browserSidebarEnvironment: SidebarEnvironment<HTMLElement> = {
  desktop: isWideViewport,
  onBreakpoint: subscribeViewport,
  read: readStorage,
  write: writeStorage,
  focused: () => (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  canFocus: (target) => target.isConnected && target.checkVisibility({ visibilityProperty: true }),
  focus: (target) => target.focus({ preventScroll: true }),
};
