import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

const mobile = () => !matchMedia("(min-width: 768px)").matches;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

// Do not animate an inherited CSS variable: that invalidates styles throughout the transcript
// and sidebar on every frame. Update only the three moving/painted surfaces instead.
function paintPosition(
  main: HTMLElement | null,
  reveal: HTMLElement | null,
  progress: number | null,
) {
  const transform = progress === null ? "" : `translate3d(${progress * 75}vw, 0, 0)`;
  const radius = progress === null ? "" : `${progress * 2}rem 0 0 ${progress * 2}rem`;
  if (main) {
    main.style.transform = transform;
    main.style.borderRadius = radius;
  }
  const navigation = reveal?.querySelector<HTMLElement>('[data-slot="sidebar-reveal-navigation"]');
  const scrim = reveal?.querySelector<HTMLElement>('[data-slot="sidebar-scrim"]');
  if (navigation)
    navigation.style.clipPath = progress === null ? "" : `inset(0 ${(1 - progress) * 100}% 0 0)`;
  if (scrim) {
    scrim.style.transform = transform;
    scrim.style.borderRadius = radius;
    scrim.style.opacity = progress === null ? "" : String(progress);
  }
}

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
  // React mounts the modal once per drag; pixel updates must not re-render its navigation.
  const [progress, setProgress] = useState<number | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const revealRef = useRef<HTMLDivElement | null>(null);
  const [settle, setSettle] = useState<{ target: boolean; duration: number } | null>(null);
  const current = useEffectEvent(() => ({ open, onOpenChange, onPreview }));
  const cancelGesture = useRef<() => void>(() => {});
  const cancelDrag = useCallback(() => cancelGesture.current(), []);
  useLayoutEffect(() => {
    // Hand the surfaces back to CSS settling only after React commits the endpoint.
    if (progress === null) paintPosition(mainRef.current, revealRef.current, null);
  }, [progress]);
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
    let frame: number | null = null;
    const cancelFrame = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const paint = () => {
      frame = null;
      if (!gesture?.claimed) return;
      paintPosition(mainRef.current, revealRef.current, gesture.position);
    };
    const cancel = () => {
      cancelFrame();
      gesture = null;
      setProgress(null);
    };
    cancelGesture.current = cancel;
    const start = (event: TouchEvent) => {
      cancel();
      setSettle(null);
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
        setProgress(clamp(g.initial + dx / g.width));
      }
      // A native, non-passive listener is necessary: React's touch listeners are passive.
      // Only a claimed horizontal drag suppresses scrolling; the browser retains edge gestures.
      if (event.cancelable) event.preventDefault();
      const elapsed = event.timeStamp - g.lastTime;
      if (elapsed > 0) {
        const sample = (touch.clientX - g.lastX) / elapsed;
        // Smooth event-to-event jitter, but respond immediately to a deliberate reversal.
        const weight = Math.min(1, elapsed / 50);
        g.velocity =
          sample * g.velocity <= 0 ? sample : g.velocity + weight * (sample - g.velocity);
      }
      g.lastX = touch.clientX;
      g.lastTime = event.timeStamp;
      g.position = clamp(g.initial + dx / g.width);
      if (frame === null) frame = requestAnimationFrame(paint);
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
      const remaining = Math.abs(Number(next) - g.position) * g.width;
      // Tracking is always 1:1 with no easing. Only the release is animated: preserve the
      // flick's pace, then decelerate, instead of imposing a fixed 300ms on every gesture.
      const speed = velocity * (Number(next) - g.position) > 0 ? Math.abs(velocity) : 0;
      const duration = Math.round(Math.min(300, Math.max(120, remaining / Math.max(0.5, speed))));
      setSettle({ target: next, duration });
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
      cancelFrame();
      document.removeEventListener("touchstart", start, true);
      document.removeEventListener("touchmove", move, true);
      document.removeEventListener("touchend", end, true);
      document.removeEventListener("touchcancel", cancel, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);

  return {
    progress: progress ?? (open ? 1 : 0),
    dragging: progress !== null,
    mainRef,
    revealRef,
    settleDuration: settle?.target === open ? settle.duration : 300,
    cancelDrag,
  };
}
