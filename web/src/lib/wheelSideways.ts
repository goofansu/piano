/**
 * A plain mouse wheel only scrolls vertically, and a sideways row (tabs, attachment tiles) has
 * nothing to scroll that way: turn a mostly vertical wheel into sideways scrolling while the row
 * can still move that way, and keep that wheel from also scrolling the page or transcript around
 * it. At either end, or when the row does not overflow, the wheel passes through. Trackpads'
 * horizontal swipes and pinch-zoom (ctrl+wheel) pass through too.
 *
 * A ref callback: React's `onWheel` is passive, so only a native listener can cancel the wheel.
 */
export function wheelSideways(row: HTMLElement | null) {
  if (!row) return;
  const onWheel = (event: WheelEvent) => {
    const delta = event.deltaY;
    if (event.ctrlKey || Math.abs(delta) <= Math.abs(event.deltaX)) return;
    const room = delta > 0 ? row.scrollWidth - row.clientWidth - row.scrollLeft : row.scrollLeft;
    if (room < 1) return;
    event.preventDefault();
    // scrollBy is a directional scroll, so a snapping row steps to its next tile in that direction.
    row.scrollBy({ left: delta });
  };
  row.addEventListener("wheel", onWheel, { passive: false });
  return () => row.removeEventListener("wheel", onWheel);
}
