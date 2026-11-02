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
 * Whether the pointer, not the keyboard, gave the latest input. Focus that moves on its own after
 * a pointer interaction (an overlay handing focus back, a tooltip trigger refocused) is drawn by
 * browsers as a keyboard ring; callers ask this before moving or showing anything for it.
 */
export function pointerLast(): boolean {
  return pointer;
}

/**
 * Radix returns focus to an overlay's trigger when it closes. Return it only when the keyboard
 * closed the overlay; a click leaves focus alone.
 */
export function returnFocusForKeyboard(event: Pick<Event, "preventDefault">) {
  if (pointer) event.preventDefault();
}
