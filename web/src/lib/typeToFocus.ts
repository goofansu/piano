import { type RefObject, useEffect } from "react";
import { overlayOpen, ownsTextInput } from "./keys.ts";

const activates = (el: EventTarget | null) =>
  el instanceof Element &&
  el.matches(
    'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="treeitem"]',
  );

export function useTypeToFocus(
  ref: RefObject<HTMLTextAreaElement | null>,
  insert: (text: string) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (
        e.key.length !== 1 ||
        ownsTextInput(e.target) ||
        (e.key === " " && activates(e.target)) ||
        overlayOpen() ||
        !ref.current ||
        ref.current.disabled ||
        !ref.current.getClientRects().length ||
        ref.current.closest("[inert]")
      )
        return;
      e.preventDefault();
      ref.current.focus();
      insert(e.key);
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain");
      if (
        !text ||
        ownsTextInput(e.target) ||
        overlayOpen() ||
        !ref.current ||
        ref.current.disabled ||
        !ref.current.getClientRects().length ||
        ref.current.closest("[inert]")
      )
        return;
      e.preventDefault();
      ref.current.focus();
      insert(text);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPaste);
    };
  }, [ref, insert, enabled]);
}
