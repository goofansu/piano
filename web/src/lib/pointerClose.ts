let pointer = false;
document.addEventListener("pointerdown", () => { pointer = true; }, true);
document.addEventListener("keydown", () => { pointer = false; }, true);

/**
 * Radix returns focus to an overlay's trigger when it closes, and browsers draw that focus as a
 * keyboard ring. Return it only when the keyboard closed the overlay; a click leaves focus alone.
 */
export function returnFocusForKeyboard(event: Event) {
  if (pointer) event.preventDefault();
}
