import { type FocusEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionEntry } from "../../../../web/src/shared/state/sessionCatalog.ts";
import { sessionKey } from "../../../../web/src/shared/state/state.ts";

const buffer = 5;

export function useSidebarWindow(sessions: readonly SessionEntry[], selectionId: string | null) {
  const list = useRef<HTMLUListElement>(null);
  const measure = useRef<HTMLLIElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [window, setWindow] = useState({ start: 0, end: 0, step: 40, padding: 0, gap: 4 });
  const [focused, setFocused] = useState<string>();
  const [menu, setMenu] = useState<string>();
  const revealed = useRef<{ key: string; selectionId: string | null } | undefined>(undefined);
  const selected = sessions.find((s) => s.selected);
  const selectedKey = selected && sessionKey(selected);
  const { positions, firstEnabled, lastEnabled } = useMemo(
    () => ({
      positions: new Map(sessions.map((s, i) => [sessionKey(s), i])),
      firstEnabled: sessions.findIndex((s) => !s.disabled),
      lastEnabled: sessions.findLastIndex((s) => !s.disabled),
    }),
    [sessions],
  );

  const update = useCallback(() => {
    const ul = list.current;
    const probe = measure.current;
    const viewport = ul?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!ul || !probe || !viewport) return;
    const css = getComputedStyle(ul);
    const gap = parseFloat(css.rowGap) || 0;
    const padding = parseFloat(css.paddingTop) || 0;
    const step = probe.getBoundingClientRect().height + gap;
    if (!step) return;
    if (!selectedKey) revealed.current = undefined;
    const index = selectedKey === undefined ? undefined : positions.get(selectedKey);
    const height = Math.max(0, sessions.length * step - gap) + 2 * padding;
    const box = viewport.getBoundingClientRect();
    if (
      index !== undefined &&
      selectedKey !== undefined &&
      (revealed.current?.key !== selectedKey || revealed.current.selectionId !== selectionId) &&
      box.height > 0 &&
      !ul.closest("[inert]") &&
      Math.abs(ul.getBoundingClientRect().height - height) < 1
    ) {
      const rowTop = ul.getBoundingClientRect().top + padding + index * step;
      const rowBottom = rowTop + step - gap;
      const delta = rowTop < box.top ? rowTop - box.top : Math.max(0, rowBottom - box.bottom);
      viewport.scrollTop += delta;
      revealed.current = { key: selectedKey, selectionId };
    }
    const top = box.top - ul.getBoundingClientRect().top - padding;
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
  }, [sessions.length, selectedKey, selectionId, positions]);
  useLayoutEffect(update);
  useLayoutEffect(() => {
    const ul = list.current;
    const viewport = ul?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const nav = ul?.closest("nav");
    if (!viewport || !nav || !measure.current) return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(nav);
    observer.observe(measure.current);
    const column = ul?.closest('[data-slot="layout-sidebar"]');
    if (column) observer.observe(column);
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
  for (let i = window.start; i < Math.min(window.end, sessions.length); i++) indices.add(i);
  if (sessions.length) {
    indices.add(0);
    indices.add(sessions.length - 1);
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
    onBlurCapture: () => {
      clearTimeout(blurTimer.current);
      blurTimer.current = setTimeout(() => retainFocus(document.activeElement), 0);
    },
  };
}
