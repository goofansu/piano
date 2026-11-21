export function trackPointerDrag(
  handle: Element,
  pointerId: number,
  handlers: {
    move: (event: PointerEvent) => void;
    finish: (event: PointerEvent) => void;
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
  handle.addEventListener("lostpointercapture", finish as EventListener);
  try {
    handle.setPointerCapture(pointerId);
  } catch {}
  return () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", finish);
    removeEventListener("pointercancel", cancel);
    removeEventListener("blur", cancel);
    handle.removeEventListener("lostpointercapture", finish as EventListener);
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  };
}
