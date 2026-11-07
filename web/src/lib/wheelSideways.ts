import type { WheelEvent } from "react";

/**
 * A plain mouse wheel only scrolls vertically, and a sideways row (tabs, attachment tiles) has
 * nothing to scroll that way: turn a mostly vertical wheel into sideways scrolling while the row
 * overflows. Trackpads' horizontal swipes pass through.
 */
export function wheelSideways(event: WheelEvent<HTMLElement>) {
  const row = event.currentTarget;
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && row.scrollWidth > row.clientWidth)
    row.scrollLeft += event.deltaY;
}
