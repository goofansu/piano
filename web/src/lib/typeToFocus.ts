import { type RefObject, useEffect } from "react";

const ownsInput = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  // Inline questions own Space on their radio buttons and actions, not just their text fields.
  (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest("form"));

/** Something else is taking keys: a menu, a listbox, a dialog. */
const overlayOpen = () =>
  !!document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [cmdk-root]');

/**
 * Typing anywhere on the page goes into the composer, as in ChatGPT. A printable key or a paste
 * that lands outside any field focuses the textarea and inserts the text there.
 */
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
        ownsInput(e.target) ||
        overlayOpen() ||
        !ref.current ||
        ref.current.disabled ||
        !ref.current.getClientRects().length ||
        // Hidden in place behind another area (one area at a time), it is not taking input.
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
        ownsInput(e.target) ||
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
