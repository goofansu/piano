import { type RefObject, useLayoutEffect } from "react";

/** The textarea grows with its text up to `max` pixels, whichever way the text got there (typing, paste, a restored draft). */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, text: string, max: number, expanded = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!expanded) {
      el.style.height = "";
      el.scrollTop = 0;
      el.scrollLeft = 0;
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, text, max, expanded]);
}
