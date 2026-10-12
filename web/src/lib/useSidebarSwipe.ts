import { type TouchEvent, useRef } from "react";

/** An optional touch shortcut, never a replacement for browser navigation or scrolling. */
export function useSidebarSwipe(direction: "open" | "close", act: () => void) {
  const start = useRef<{ id: number; x: number; y: number; time: number } | null>(null);
  const cancel = () => {
    start.current = null;
  };
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      cancel();
      if (matchMedia("(min-width: 768px)").matches || event.touches.length !== 1) return;
      const touch = event.touches[0];
      // Reserve both screen edges for the browser. Opening starts in a narrow interior strip.
      if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
      if (direction === "open" && touch.clientX > 80) return;
      const target = event.target;
      if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
      if (
        target.closest(
          'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      for (let element: Element | null = target; element; element = element.parentElement) {
        const overflow = getComputedStyle(element).overflowX;
        if (element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(overflow)) return;
        if (element === event.currentTarget) break;
      }
      if (window.getSelection()?.toString()) return;
      start.current = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
      };
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const origin = start.current;
      if (!origin) return;
      const touch = Array.from(event.touches).find((touch) => touch.identifier === origin.id);
      if (event.touches.length !== 1 || !touch) return cancel();
      const dx = touch.clientX - origin.x;
      const dy = Math.abs(touch.clientY - origin.y);
      // Once scrolling starts, a later sideways movement must not turn it into a swipe.
      if (dy > 12 && dy > Math.abs(dx) / 2) cancel();
      if ((direction === "open" ? dx : -dx) < -12) cancel();
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const origin = start.current;
      cancel();
      if (!origin || event.touches.length || matchMedia("(min-width: 768px)").matches) return;
      const touch = Array.from(event.changedTouches).find(
        (touch) => touch.identifier === origin.id,
      );
      if (!touch) return;
      const dx = (touch.clientX - origin.x) * (direction === "open" ? 1 : -1);
      const dy = Math.abs(touch.clientY - origin.y);
      if (dx >= 64 && dx > dy * 2 && event.timeStamp - origin.time <= 600) act();
    },
    onTouchCancel: cancel,
  };
}
