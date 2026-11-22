import {
  type CSSProperties,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type SwipeEnd, type SwipeGesture, startSwipe } from "./swipeGesture.ts";

export const SIDEBAR_REVEAL_WIDTH = 0.75;
export const SIDEBAR_REVEAL_RADIUS = 2;

function paintPosition(
  main: HTMLElement | null,
  reveal: HTMLElement | null,
  progress: number | null,
) {
  const transform =
    progress === null ? "" : `translate3d(${progress * SIDEBAR_REVEAL_WIDTH * 100}vw, 0, 0)`;
  const corner = progress === null ? "" : `${progress * SIDEBAR_REVEAL_RADIUS}rem`;
  const radius = progress === null ? "" : `${corner} 0 0 ${corner}`;
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

export function useSidebarSwipe({
  open,
  onOpenChange,
  onPreview,
  mobile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: () => void;
  mobile: () => boolean;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const revealRef = useRef<HTMLDivElement | null>(null);
  const [settle, setSettle] = useState<{
    target: boolean;
    duration: number;
    easing: string;
  } | null>(null);
  const current = useEffectEvent(() => ({ open, onOpenChange, onPreview, mobile }));
  const cancelGesture = useRef<() => void>(() => {});
  const cancelDrag = useCallback(() => cancelGesture.current(), []);
  useLayoutEffect(() => {
    if (progress === null) paintPosition(mainRef.current, revealRef.current, null);
  }, [progress]);
  useEffect(cancelDrag, [open, cancelDrag]);

  useEffect(() => {
    let gesture: { id: number; swipe: SwipeGesture; position: number | null } | null = null;
    let suppressClickUntil = 0;
    let frame: number | null = null;
    const cancelFrame = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const paint = () => {
      frame = null;
      if (gesture?.position == null) return;
      paintPosition(mainRef.current, revealRef.current, gesture.position);
    };
    const cancel = () => {
      cancelFrame();
      gesture = null;
      setProgress(null);
    };
    const hasSelection = () => window.getSelection()?.isCollapsed === false;
    const yieldToSelection = () => {
      suppressClickUntil = 0;
      cancel();
    };
    const selectionChanged = () => {
      if (hasSelection()) yieldToSelection();
    };
    cancelGesture.current = cancel;
    const start = (event: TouchEvent) => {
      cancel();
      setSettle(null);
      suppressClickUntil = 0;
      if (!current().mobile() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target;
      if (!(target instanceof Element)) return;
      const pane = target.closest('[data-slot="layout-main"], [data-slot="mobile-sidebar"]');
      if (!pane) return;
      const { open } = current();
      if (open !== pane.matches('[data-slot="mobile-sidebar"]')) return;
      if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
      const control = target.closest(
        'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="slider"]',
      );
      if (control && !control.matches('[data-slot="sidebar-scrim"], button[data-sidebar-swipe]'))
        return;
      for (let element: Element | null = target; element; element = element.parentElement) {
        if (
          element.scrollWidth > element.clientWidth + 1 &&
          /auto|scroll/.test(getComputedStyle(element).overflowX)
        )
          return;
        if (element === pane) break;
      }
      if (hasSelection()) return;
      gesture = {
        id: touch.identifier,
        swipe: startSwipe(
          { x: touch.clientX, y: touch.clientY, time: event.timeStamp },
          open,
          innerWidth * SIDEBAR_REVEAL_WIDTH,
        ),
        position: null,
      };
    };
    const move = (event: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      const touch = Array.from(event.touches).find((touch) => touch.identifier === g.id);
      const outcome = g.swipe.move({
        point: touch ? { x: touch.clientX, y: touch.clientY } : null,
        touches: event.touches.length,
        time: event.timeStamp,
        cancelable: event.cancelable,
        selecting: hasSelection(),
      });
      if (outcome.kind === "ignore") return;
      if (outcome.kind === "yield") return yieldToSelection();
      if (outcome.kind === "cancel") return cancel();
      if (outcome.kind === "claim") {
        if (outcome.opening) current().onPreview();
        setProgress(outcome.position);
      }
      if (event.cancelable) event.preventDefault();
      g.position = outcome.position;
      if (frame === null) frame = requestAnimationFrame(paint);
      suppressClickUntil = performance.now() + 500;
    };
    const end = (event: TouchEvent) => {
      const selecting = hasSelection();
      const outcome: SwipeEnd = gesture?.swipe.end({
        touches: event.touches.length,
        time: event.timeStamp,
        selecting,
      }) ?? { kind: selecting ? "yield" : "cancel" };
      if (outcome.kind === "yield") return yieldToSelection();
      if (outcome.kind === "cancel") return cancel();
      suppressClickUntil = performance.now() + 500;
      cancel();
      const { open: next, duration, easing } = outcome;
      setSettle({ target: next, duration, easing });
      const state = current();
      if (next !== state.open) state.onOpenChange(next);
    };
    const click = (event: MouseEvent) => {
      if (event.detail && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("selectionchange", selectionChanged);
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
      document.removeEventListener("selectionchange", selectionChanged);
      document.removeEventListener("touchstart", start, true);
      document.removeEventListener("touchmove", move, true);
      document.removeEventListener("touchend", end, true);
      document.removeEventListener("touchcancel", cancel, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);

  const settling = settle?.target === open;
  return {
    dragging: progress !== null,
    mainRef,
    revealRef,
    style: {
      "--sidebar-progress": progress ?? (open ? 1 : 0),
      "--sidebar-reveal-width": `${SIDEBAR_REVEAL_WIDTH * 100}vw`,
      "--sidebar-reveal-radius": `${SIDEBAR_REVEAL_RADIUS}rem`,
      "--sidebar-duration": `${settling ? settle.duration : 300}ms`,
      "--sidebar-easing": settling ? settle.easing : "var(--ease-drawer)",
    } as CSSProperties,
    cancelDrag,
  };
}
