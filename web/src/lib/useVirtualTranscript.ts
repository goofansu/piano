import { elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { messageAnchorId, type TranscriptProjection } from "./transcript";
import {
  domViewportElement,
  TRANSCRIPT_JUMP_MARGIN,
  type TranscriptViewport,
} from "./transcriptViewport";

export function useVirtualTranscript(
  { history, pending }: TranscriptProjection,
  container: RefObject<HTMLDivElement | null>,
  list: RefObject<HTMLDivElement | null>,
  viewport: TranscriptViewport,
) {
  const [margin, setMargin] = useState(0);
  const [target, setTarget] = useState<{ id: string; animate: boolean } | null>(null);
  const highlight = useRef<Animation | null>(null);
  const pendingKey = pending?.key;
  const pendingId = pending?.msg.id;
  const getItemKey = useCallback(
    (index: number) => history[index]?.key ?? pendingKey!,
    [history, pendingKey],
  );
  const indexes = useMemo(() => {
    const result = new Map(history.map((row, index) => [row.msg.id, index]));
    if (pendingId !== undefined) result.set(pendingId, history.length);
    return result;
  }, [history, pendingId]);
  const indexRef = useRef(indexes);
  indexRef.current = indexes;
  const virtual = useVirtualizer({
    count: history.length + (pending ? 1 : 0),
    useFlushSync: true,
    getScrollElement: () => container.current,
    getItemKey,
    estimateSize: () => 240,
    overscan: 3,
    initialRect: { width: 768, height: 900 },
    scrollMargin: margin,
    scrollPaddingStart: TRANSCRIPT_JUMP_MARGIN,
    scrollToFn: (offset, options, instance) => {
      viewport.correct(() => elementScroll(offset, options, instance));
    },
  });

  virtual.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.end <= (instance.scrollOffset ?? 0);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const dom = domViewportElement(el);
    viewport.attach({
      ...dom,
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
        highlight.current?.cancel();
        setTarget(null);
        if (edge === "bottom") virtual.scrollToEnd();
        else virtual.scrollToOffset(0);
      },
      jumpToMessage: (id, animate) => {
        const index = indexRef.current.get(id);
        if (index === undefined) return false;
        highlight.current?.cancel();
        setTarget({ id, animate });
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
    return () => {
      highlight.current?.cancel();
      viewport.attach(null);
    };
  }, [container, viewport, virtual]);

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- measure and notify the viewport after every render.
  useLayoutEffect(() => {
    const el = container.current;
    const inner = list.current;
    if (!el || !inner) return;
    setMargin(inner.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop);
    viewport.rendered();
    if (target && !virtual.isScrolling) {
      const anchor = el.ownerDocument.getElementById(messageAnchorId(target.id));
      if (anchor && viewport.landed(target.id)) {
        const content = anchor.querySelector<HTMLElement>('[data-slot="row-content"]');
        const body = content?.querySelector<HTMLElement>(":scope > .prose-chat") ?? content;
        if (body) {
          const tint = "color-mix(in oklab, var(--brand) 12%, transparent)";
          const fade = target.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
          highlight.current = body.animate(
            [
              {
                backgroundColor: tint,
                boxShadow: `0 0 0 6px ${tint}`,
                borderRadius: "var(--radius-md)",
                offset: 0,
              },
              {
                backgroundColor: tint,
                boxShadow: `0 0 0 6px ${tint}`,
                borderRadius: "var(--radius-md)",
                offset: 0.25,
              },
              {
                backgroundColor: "transparent",
                boxShadow: "0 0 0 6px transparent",
                borderRadius: "var(--radius-md)",
                offset: 1,
              },
            ],
            { duration: 800, easing: fade ? "linear" : "steps(1, end)" },
          );
        }
        setTarget(null);
      }
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
