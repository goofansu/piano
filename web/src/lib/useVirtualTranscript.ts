import { elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TranscriptRow } from "./transcript";
import { domViewportElement, type TranscriptViewport } from "./transcriptViewport";

/** Geometry is a projection, never history. The viewport owns reader intent; the virtualizer
 * owns measured offsets and refines index jumps as the destination's neighbours mount. */
export function useVirtualTranscript(
  rows: readonly TranscriptRow[],
  container: RefObject<HTMLDivElement | null>,
  list: RefObject<HTMLDivElement | null>,
  viewport: TranscriptViewport,
) {
  const [margin, setMargin] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  const indexes = useMemo(() => new Map(rows.map((row, index) => [row.msg.id, index])), [rows]);
  const indexRef = useRef(indexes);
  indexRef.current = indexes;
  const virtual = useVirtualizer({
    count: rows.length,
    useFlushSync: true,
    getScrollElement: () => container.current,
    getItemKey,
    estimateSize: () => 240,
    overscan: 3,
    // A bounded first paint (also in static rendering); the real container replaces this guess.
    initialRect: { width: 768, height: 900 },
    scrollMargin: margin,
    scrollPaddingStart: 16,
    scrollToFn: (offset, options, instance) => {
      viewport.correct(() => elementScroll(offset, options, instance));
    },
  });

  // A visible row growing should grow below the reader, not move the text they are reading.
  virtual.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.end <= (instance.scrollOffset ?? 0);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const dom = domViewportElement(el);
    viewport.attach({
      ...dom,
      // Spreading accessors snapshots them; keep all geometry live.
      get scrollHeight() {
        return el.scrollHeight;
      },
      get scrollTop() {
        return el.scrollTop;
      },
      set scrollTop(top: number) {
        el.scrollTop = top;
      },
      get clientHeight() {
        return el.clientHeight;
      },
      jumpToEdge: (edge) => {
        setTarget(null);
        if (edge === "bottom") virtual.scrollToEnd();
        else virtual.scrollToOffset(0);
      },
      jumpToMessage: (id) => {
        const index = indexRef.current.get(id);
        if (index === undefined) return false;
        setTarget(id);
        virtual.scrollToIndex(index, { align: "start" });
        return true;
      },
      anchorTop: (id) => {
        const measured = dom.anchorTop(id);
        if (measured !== undefined) return measured;
        const index = indexRef.current.get(id);
        const item = index === undefined ? undefined : virtual.measurementsCache[index];
        return item ? item.start - el.scrollTop : undefined;
      },
    });
    return () => viewport.attach(null);
  }, [container, viewport, virtual]);

  useLayoutEffect(() => {
    const el = container.current;
    const inner = list.current;
    if (!el || !inner) return;
    setMargin(inner.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop);
    viewport.rendered();
    if (target && !virtual.isScrolling) {
      const top = domViewportElement(el).anchorTop(target);
      if (
        top !== undefined &&
        (Math.abs(top - 16) < 1 || el.scrollHeight - el.scrollTop - el.clientHeight < 1)
      )
        setTarget(null);
    }
  });
  useLayoutEffect(() => {
    const el = container.current;
    const inner = list.current;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => {
      setMargin(inner.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop);
      viewport.rendered();
      viewport.resized({ container: true });
    });
    observer.observe(el);
    if (inner.parentElement) observer.observe(inner.parentElement);
    return () => observer.disconnect();
  }, [container, list, viewport]);
  return { virtual, jumping: target !== null };
}
