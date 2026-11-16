import { type RefObject, useEffect } from "react";

export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, text: string, max: number) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, text, max]);
}
