import { type RefObject, useEffect } from "react";

/** The textarea grows with its text up to `max` pixels, whichever way the text got there (typing, paste, a restored draft). */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, text: string, max: number) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: text changes the textarea DOM scrollHeight, including restored drafts and programmatic edits.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, text, max]);
}
