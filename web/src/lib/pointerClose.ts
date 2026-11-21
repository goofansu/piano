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

// Base UI asks for the final focus while the closing popup still holds focus, and focuses whatever
// a function returns even when focus has since moved, for example into a dialog a menu item opened.
export function focusMovedOn(): boolean {
  const current = document.activeElement;
  return (
    current instanceof HTMLElement && current !== document.body && !current.closest("[data-closed]")
  );
}

export function keyboardFocusReturn(): boolean {
  return !pointer && !focusMovedOn();
}
