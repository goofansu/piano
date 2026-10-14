/**
 * Tracks one pointer from a pointerdown until it is released or lost: the window listeners a
 * drag needs, removed as one. Both resizable columns (the sidebar and the right panel) share it,
 * so neither forgets a cancel path.
 */
export function trackPointerDrag(
  pointerId: number,
  handlers: {
    move: (event: PointerEvent) => void;
    /** The pointer was released: commit. */
    finish: (event: PointerEvent) => void;
    /** The pointer was lost (cancel, window blur): revert. */
    cancel: () => void;
  },
): () => void {
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointerId) handlers.move(event);
  };
  const finish = (event: PointerEvent) => {
    if (event.pointerId === pointerId) handlers.finish(event);
  };
  const cancel = () => handlers.cancel();
  addEventListener("pointermove", move);
  addEventListener("pointerup", finish);
  addEventListener("pointercancel", cancel);
  addEventListener("blur", cancel);
  return () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", finish);
    removeEventListener("pointercancel", cancel);
    removeEventListener("blur", cancel);
  };
}
