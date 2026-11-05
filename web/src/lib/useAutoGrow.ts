import { type RefObject, useLayoutEffect } from "react";

/** Grow for text, restored drafts, wrapping width and revealing the same mounted editor. */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  text: string,
  max: number,
  visible = true,
) {
  // Extra dependency: text changes scrollHeight, including programmatic edits.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !visible) return;
    const grow = () => {
      if (!el.getClientRects().length) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    };
    grow();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      grow();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text, max, visible]);
}
