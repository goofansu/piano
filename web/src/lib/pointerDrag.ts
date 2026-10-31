/**
 * Tracks one pointer from a pointerdown until it is released or lost: the listeners a drag needs,
 * removed as one. Both resizable columns (the sidebar and the right panel) share it, so neither
 * forgets a cancel path.
 *
 * The pressed `handle` captures the pointer, so its events stay in Piano's document even when the
 * pointer crosses an embedded app: without capture, a release over a Preview frame goes to that
 * frame's browsing context and Piano's window never hears it. Should a release still go unheard,
 * the next move with no button held ends the drag where it was.
 */
export function trackPointerDrag(
  handle: Element,
  pointerId: number,
  handlers: {
    move: (event: PointerEvent) => void;
    /** The pointer was released, or capture ended without a cancel: commit. */
    finish: (event: PointerEvent) => void;
    /** The pointer was lost (cancel, window blur): revert. */
    cancel: () => void;
  },
): () => void {
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (event.buttons === 0) handlers.finish(event);
    else handlers.move(event);
  };
  const finish = (event: PointerEvent) => {
    if (event.pointerId === pointerId) handlers.finish(event);
  };
  const cancel = (event: Event) => {
    if (!(event instanceof PointerEvent) || event.pointerId === pointerId) handlers.cancel();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", finish);
  addEventListener("pointercancel", cancel);
  addEventListener("blur", cancel);
  // Fires after pointerup and pointercancel (listeners are gone by then), or alone when the
  // browser ends capture some other way.
  handle.addEventListener("lostpointercapture", finish as EventListener);
  try {
    handle.setPointerCapture(pointerId);
  } catch {
    // The pointer is no longer active; the window listeners and the buttons check still end it.
  }
  return () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", finish);
    removeEventListener("pointercancel", cancel);
    removeEventListener("blur", cancel);
    handle.removeEventListener("lostpointercapture", finish as EventListener);
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  };
}
