let pointer = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      pointer = true;
    },
    true,
  );
  document.addEventListener(
    "keydown",
    () => {
      pointer = false;
    },
    true,
  );
}

/**
 * Radix returns focus to an overlay's trigger when it closes, and browsers draw that focus as a
 * keyboard ring. Return it only when the keyboard closed the overlay; a click leaves focus alone.
 * The same policy prevents tooltips opening on focus restored after a pointer interaction.
 */
export function preventPointerFocus(event: Pick<Event, "preventDefault">) {
  if (pointer) event.preventDefault();
}

export { preventPointerFocus as returnFocusForKeyboard };
