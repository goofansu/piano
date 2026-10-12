import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

const mobile = () => !matchMedia("(min-width: 768px)").matches;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Owns only the transient drag; the layout still owns the committed open state. */
export function useSidebarSwipe({
  open,
  onOpenChange,
  onPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const current = useEffectEvent(() => ({ open, onOpenChange, onPreview }));
  const cancelGesture = useRef<() => void>(() => {});
  const cancelDrag = useCallback(() => cancelGesture.current(), []);
  // A command or navigation can change the committed state while a finger is still down.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open is the external cancellation signal.
  useEffect(cancelDrag, [open, cancelDrag]);

  useEffect(() => {
    let gesture: {
      id: number;
      x: number;
      y: number;
      width: number;
      initial: number;
      claimed: boolean;
      position: number;
      lastX: number;
      lastTime: number;
      velocity: number;
    } | null = null;
    let suppressClickUntil = 0;
    const cancel = () => {
      gesture = null;
      setProgress(null);
    };
    cancelGesture.current = cancel;
    const start = (event: TouchEvent) => {
      cancel();
      suppressClickUntil = 0; // A new deliberate tap is not the preceding drag's compatibility click.
      if (!mobile() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target;
      if (!(target instanceof Element)) return;
      const surface = target.closest('[data-slot="layout-main"], [data-slot="mobile-sidebar"]');
      if (!surface) return; // Never borrow gestures from portaled menus or other dialogs.
      const { open } = current();
      if (open !== surface.matches('[data-slot="mobile-sidebar"]')) return;
      if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
      if (!open && touch.clientX > 80) return;
      if (
        !target.closest('[data-slot="sidebar-scrim"]') &&
        target.closest(
          'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="slider"]',
        )
      )
        return;
      for (let element: Element | null = target; element; element = element.parentElement) {
        if (
          element.scrollWidth > element.clientWidth + 1 &&
          /auto|scroll/.test(getComputedStyle(element).overflowX)
        )
          return;
        if (element === surface) break;
      }
      if (window.getSelection()?.toString()) return;
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        width: innerWidth * 0.75,
        initial: open ? 1 : 0,
        claimed: false,
        position: open ? 1 : 0,
        lastX: touch.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
      };
    };
    const move = (event: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      const touch = Array.from(event.touches).find((touch) => touch.identifier === g.id);
      if (!touch || event.touches.length !== 1) return cancel();
      const dx = touch.clientX - g.x;
      const dy = Math.abs(touch.clientY - g.y);
      if (!g.claimed) {
        if (dy > 10 && dy > Math.abs(dx) / 2) return cancel();
        if (Math.abs(dx) < 10) return;
        if ((g.initial === 0 ? dx : -dx) < 0 || !event.cancelable) return cancel();
        g.claimed = true;
        if (!g.initial) current().onPreview();
      }
      // A native, non-passive listener is necessary: React's touch listeners are passive.
      // Only a claimed horizontal drag suppresses scrolling; the browser retains edge gestures.
      if (event.cancelable) event.preventDefault();
      const elapsed = event.timeStamp - g.lastTime;
      if (elapsed > 0) g.velocity = (touch.clientX - g.lastX) / elapsed;
      g.lastX = touch.clientX;
      g.lastTime = event.timeStamp;
      g.position = clamp(g.initial + dx / g.width);
      setProgress(g.position);
      suppressClickUntil = performance.now() + 500;
    };
    const end = (event: TouchEvent) => {
      const g = gesture;
      if (!g?.claimed || event.touches.length) return cancel();
      const velocity = event.timeStamp - g.lastTime < 100 ? g.velocity : 0;
      const moved = Math.abs(g.position - g.initial) * g.width;
      const next = moved >= 24 && Math.abs(velocity) > 0.5 ? velocity > 0 : g.position >= 0.5;
      suppressClickUntil = performance.now() + 500;
      cancel();
      const state = current();
      if (next !== state.open) state.onOpenChange(next);
    };
    const click = (event: MouseEvent) => {
      if (event.detail && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("touchstart", start, { passive: true, capture: true });
    document.addEventListener("touchmove", move, { passive: false, capture: true });
    document.addEventListener("touchend", end, true);
    document.addEventListener("touchcancel", cancel, true);
    document.addEventListener("click", click, true);
    window.addEventListener("resize", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      cancelGesture.current = () => {};
      document.removeEventListener("touchstart", start, true);
      document.removeEventListener("touchmove", move, true);
      document.removeEventListener("touchend", end, true);
      document.removeEventListener("touchcancel", cancel, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);

  return { progress: progress ?? (open ? 1 : 0), dragging: progress !== null, cancelDrag };
}
