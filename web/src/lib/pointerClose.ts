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

export function pointerLast(): boolean {
  return pointer;
}

export function returnFocusForKeyboard(event: Pick<Event, "preventDefault">) {
  if (pointer) event.preventDefault();
}

export function keyboardFocusReturn(): boolean {
  return !pointer;
}
