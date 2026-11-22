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

export function focusMovedOn(): boolean {
  const current = document.activeElement;
  return (
    current instanceof HTMLElement && current !== document.body && !current.closest("[data-closed]")
  );
}

export function keyboardFocusReturn(): boolean {
  return !pointer && !focusMovedOn();
}
