import { type FocusEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sessionKey } from "../store.ts";
import type { SessionEntry } from "./sessionCatalog.ts";

const buffer = 5;

/** Fixed-height session rows, windowed against the sidebar's ONE scroll viewport, not each group.
 * Measure the existing row CSS so touch, phone and rem sizing stay owned by Sidebar.
 * Group headers remain ordinary flow; observing the nav catches groups above opening/closing.
 */
export function useSidebarWindow(sessions: readonly SessionEntry[]) {
  const list = useRef<HTMLUListElement>(null);
  const measure = useRef<HTMLLIElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [window, setWindow] = useState({ start: 0, end: 0, step: 40, padding: 0, gap: 4 });
  const [focused, setFocused] = useState<string>();
  const [menu, setMenu] = useState<string>();
  const { positions, firstEnabled, lastEnabled } = useMemo(
    () => ({
      positions: new Map(sessions.map((s, i) => [sessionKey(s), i])),
      firstEnabled: sessions.findIndex((s) => !s.disabled),
      lastEnabled: sessions.findLastIndex((s) => !s.disabled),
    }),
    [sessions],
  );

  // Re-read after a parent render too: a reorder can move this group without resizing the nav.
  const update = useCallback(() => {
    const ul = list.current;
    const probe = measure.current;
    const viewport = ul?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!ul || !probe || !viewport) return;
    const css = getComputedStyle(ul);
    const gap = parseFloat(css.rowGap) || 0;
    const padding = parseFloat(css.paddingTop) || 0;
    const step = probe.getBoundingClientRect().height + gap;
    if (!step) return;
    const top = viewport.getBoundingClientRect().top - ul.getBoundingClientRect().top - padding;
    const start = Math.min(sessions.length, Math.max(0, Math.floor(top / step) - buffer));
    const end = Math.min(
      sessions.length,
      Math.max(0, Math.ceil((top + viewport.clientHeight) / step) + buffer),
    );
    setWindow((old) =>
      old.start === start &&
      old.end === end &&
      old.step === step &&
      old.padding === padding &&
      old.gap === gap
        ? old
        : { start, end, step, padding, gap },
    );
  }, [sessions.length]);
  useLayoutEffect(update);
  useLayoutEffect(() => {
    const ul = list.current;
    const viewport = ul?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    const nav = ul?.closest("nav");
    if (!viewport || !nav || !measure.current) return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(nav);
    observer.observe(measure.current);
    viewport.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", update);
      clearTimeout(blurTimer.current);
    };
  }, [update]);

  const onMenuChange = useCallback((key: string, open: boolean) => {
    setMenu((old) => (open ? key : old === key ? undefined : old));
  }, []);
  const retainFocus = useCallback((target: EventTarget | null) => {
    const row =
      target instanceof Element ? target.closest<HTMLElement>("[data-session-key]") : null;
    setFocused(row && list.current?.contains(row) ? row.dataset.sessionKey : undefined);
  }, []);

  const indices = new Set<number>();
  // Registry changes can shorten the list before the layout effect recalculates its window.
  for (let i = window.start; i < Math.min(window.end, sessions.length); i++) indices.add(i);
  // Keep both ends keyboard-reachable, even when an entire group is outside the viewport.
  // A focused row's neighbours let native Tab/Shift+Tab advance into the next window.
  if (sessions.length) {
    indices.add(0);
    indices.add(sessions.length - 1);
    // On phones row menus are hidden, so unavailable sessions are not Tab stops.
    if (firstEnabled !== -1) indices.add(firstEnabled);
    if (lastEnabled !== -1) indices.add(lastEnabled);
  }
  const focusIndex = focused === undefined ? undefined : positions.get(focused);
  if (focusIndex !== undefined) {
    for (
      let i = Math.max(0, focusIndex - 1);
      i <= Math.min(sessions.length - 1, focusIndex + 1);
      i++
    )
      indices.add(i);
    for (const direction of [-1, 1]) {
      let i = focusIndex + direction;
      while (i >= 0 && i < sessions.length && sessions[i].disabled) i += direction;
      if (i >= 0 && i < sessions.length) indices.add(i);
    }
  }
  const menuIndex = menu === undefined ? undefined : positions.get(menu);
  if (menuIndex !== undefined) indices.add(menuIndex);

  return {
    list,
    measure,
    indices: [...indices].sort((a, b) => a - b),
    height: Math.max(0, sessions.length * window.step - window.gap) + 2 * window.padding,
    top: (index: number) => index * window.step + window.padding,
    onMenuChange,
    onFocusCapture: (event: FocusEvent<HTMLUListElement>) => {
      clearTimeout(blurTimer.current);
      retainFocus(event.target);
    },
    // Wait a TASK, not a microtask: native Tab has not focused its destination during blur.
    // Removing nodes in that gap can also make the phone sheet's focus trap steal focus.
    // A focus inside this list cancels the release; Radix's portal is retained by menu.
    onBlurCapture: () => {
      clearTimeout(blurTimer.current);
      blurTimer.current = setTimeout(() => retainFocus(document.activeElement), 0);
    },
  };
}
