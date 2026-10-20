import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { SessionEntry } from "@/lib/sessionCatalog";
import { sessionKey } from "@/store";

/** Changes only when group geometry can move a list; selection/token updates are not layout changes. */
export const SessionListLayout = createContext("");

export interface SessionRowPosition {
  index: number;
  top: number;
  total: number;
}

interface Geometry {
  height: number;
  gap: number;
  margin: number;
  paddingStart: number;
  paddingEnd: number;
}

/** shadcn has no windowed list primitive. Keep its ScrollArea, disclosure groups and row menus;
 * TanStack owns the viewport range. Only large groups use this layout, not a second session model. */
export function WindowedSessionList({
  sessions,
  className,
  rowClassName,
  children,
}: {
  sessions: readonly SessionEntry[];
  className: string;
  rowClassName: string;
  children: (
    session: SessionEntry,
    position: SessionRowPosition,
    menuChanged: (key: string, open: boolean) => void,
  ) => ReactNode;
}) {
  const layout = useContext(SessionListLayout);
  const list = useRef<HTMLUListElement>(null);
  const probe = useRef<HTMLLIElement>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const selected = sessions.findIndex((s) => s.selected);
  const selectedKey = selected < 0 ? null : sessionKey(sessions[selected]);
  const focusedIndex = sessions.findIndex((s) => sessionKey(s) === focused);
  const menuIndex = sessions.findIndex((s) => sessionKey(s) === menu);
  // Phone menus are hidden. Native Tab entry still needs the first/last enabled session when
  // unavailable histories occupy the ends of a group.
  const firstEnabled = sessions.findIndex((s) => !s.disabled);
  const lastEnabled = sessions.findLastIndex((s) => !s.disabled);
  const getItemKey = useCallback((index: number) => sessionKey(sessions[index]), [sessions]);
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          // Native Tab entry from either end, plus the controls that must survive scrolling.
          0,
          sessions.length - 1,
          firstEnabled,
          lastEnabled,
          selected,
          focusedIndex,
          menuIndex,
        ]),
      ]
        .filter((index) => index >= 0)
        .sort((a, b) => a - b),
    [sessions.length, firstEnabled, lastEnabled, selected, focusedIndex, menuIndex],
  );
  const virtual = useVirtualizer<HTMLElement, HTMLLIElement>({
    count: sessions.length,
    getScrollElement: () => list.current?.closest('[data-slot="scroll-area-viewport"]') ?? null,
    estimateSize: () => geometry?.height ?? 36,
    getItemKey,
    gap: geometry?.gap ?? 4,
    scrollMargin: geometry?.margin ?? 0,
    paddingStart: geometry?.paddingStart ?? 0,
    paddingEnd: geometry?.paddingEnd ?? 0,
    overscan: 6,
    rangeExtractor,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: group geometry can move this list without changing the nav's total height.
  useLayoutEffect(() => {
    const ul = list.current!;
    const sample = probe.current!;
    const viewport = ul.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    const measure = () => {
      if (!viewport.clientHeight) return;
      const css = getComputedStyle(ul);
      const next: Geometry = {
        height: sample.getBoundingClientRect().height,
        gap: parseFloat(css.rowGap) || 0,
        margin:
          ul.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop,
        paddingStart: parseFloat(css.paddingTop) || 0,
        paddingEnd: parseFloat(css.paddingBottom) || 0,
      };
      setGeometry((before) =>
        before &&
        Object.keys(next).every(
          (key) => before[key as keyof Geometry] === next[key as keyof Geometry],
        )
          ? before
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sample);
    observer.observe(viewport);
    // Other groups can expand/collapse above this list, changing its scroll margin.
    observer.observe(ul.closest("nav")!);
    return () => observer.disconnect();
  }, [layout]);

  const rowHeight = geometry?.height;
  useLayoutEffect(() => {
    if (rowHeight) virtual.measure();
  }, [virtual, rowHeight]);

  useLayoutEffect(() => {
    if (geometry && selectedKey && selected >= 0)
      virtual.scrollToIndex(selected, { align: "auto" });
    // Do not follow ordinary scrolls or transcript/registry updates with unchanged selection.
  }, [virtual, selected, selectedKey, geometry]);

  const menuChanged = useCallback((key: string, open: boolean) => {
    setMenu(open ? key : null);
    // Keep the trigger mounted through Radix's close/focus restoration, even outside the window.
    if (!open) setFocused(key);
  }, []);
  const controls = (row: Element) =>
    [...row.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].filter(
      (button) => button.getClientRects().length > 0,
    );

  return (
    <ul
      ref={list}
      className={className}
      style={{ position: "relative", height: virtual.getTotalSize(), overflowAnchor: "none" }}
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.target)) return; // portalled menu
        const row = event.target.closest<HTMLElement>("[data-window-index]");
        if (row) setFocused(sessionKey(sessions[Number(row.dataset.windowIndex)]));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-window-index]");
        if (!row) return;
        const buttons = controls(row);
        if (event.target !== (event.shiftKey ? buttons[0] : buttons.at(-1))) return;
        const direction = event.shiftKey ? -1 : 1;
        let index = Number(row.dataset.windowIndex) + direction;
        const hasMenu = buttons.some((button) => button.hasAttribute("aria-haspopup"));
        // On phones the row menu is hidden; skip history-unavailable rows with no focusable control.
        while (index >= 0 && index < sessions.length && sessions[index].disabled && !hasMenu)
          index += direction;
        if (index < 0 || index >= sessions.length) return; // native Tab leaves this group
        event.preventDefault();
        flushSync(() => setFocused(sessionKey(sessions[index])));
        virtual.scrollToIndex(index, { align: "auto" });
        const next = list.current!.querySelector(`[data-window-index="${index}"]`)!;
        const targets = controls(next);
        (event.shiftKey ? targets.at(-1) : targets[0])?.focus({ preventScroll: true });
      }}
    >
      {/* Measure the existing responsive row CSS, rather than duplicating pointer/breakpoint rules. */}
      <li
        ref={probe}
        aria-hidden
        className={rowClassName}
        style={{ position: "absolute", visibility: "hidden" }}
      />
      {virtual.getVirtualItems().map((item) =>
        children(
          sessions[item.index],
          {
            index: item.index,
            top: item.start - (geometry?.margin ?? 0),
            total: sessions.length,
          },
          menuChanged,
        ),
      )}
    </ul>
  );
}
