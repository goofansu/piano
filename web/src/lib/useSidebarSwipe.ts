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

/** Owns only the transient swipe; the sidebar layout owns the committed open state and the breakpoint. */
export function useSidebarSwipe({
  open,
  onOpenChange,
  onPreview,
  mobile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: () => void;
  /** Whether the sheet applies now; swipes do nothing above the breakpoint. */
  mobile: () => boolean;
}) {
  // React mounts the modal once per drag; pixel updates must not re-render its navigation.
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
    // Hand the surfaces back to CSS settling only after React commits the endpoint.
    if (progress === null) paintPosition(mainRef.current, revealRef.current, null);
  }, [progress]);
  // A command or navigation can change the committed state while a finger is still down.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open is the external cancellation signal.
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
    // A long press creates its selection after touchstart. Once selection takes over,
    // abandon the whole gesture, even if the range later collapses while dragging a handle.
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
      suppressClickUntil = 0; // A new deliberate tap is not the preceding drag's compatibility click.
      if (!current().mobile() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target;
      if (!(target instanceof Element)) return;
      const surface = target.closest('[data-slot="layout-main"], [data-slot="mobile-sidebar"]');
      if (!surface) return; // Never borrow gestures from portaled menus or other dialogs.
      const { open } = current();
      if (open !== surface.matches('[data-slot="mobile-sidebar"]')) return;
      if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
      const control = target.closest(
        'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="slider"]',
      );
      // Transcript disclosures act on click, so a claimed swipe can safely suppress the tap.
      // Other controls (especially editors and pointer-down menus) retain their own gestures.
      if (control && !control.matches('[data-slot="sidebar-scrim"], button[data-sidebar-swipe]'))
        return;
      for (let element: Element | null = target; element; element = element.parentElement) {
        if (
          element.scrollWidth > element.clientWidth + 1 &&
          /auto|scroll/.test(getComputedStyle(element).overflowX)
        )
          return;
        if (element === surface) break;
      }
      if (hasSelection()) return;
      gesture = {
        id: touch.identifier,
        swipe: startSwipe(
          { x: touch.clientX, y: touch.clientY, time: event.timeStamp },
          open,
          innerWidth * 0.75,
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
        // selectionchange may not have been delivered yet when this touch event arrives.
        selecting: hasSelection(),
      });
      if (outcome.kind === "ignore") return;
      if (outcome.kind === "yield") return yieldToSelection();
      if (outcome.kind === "cancel") return cancel();
      if (outcome.kind === "claim") {
        if (outcome.opening) current().onPreview();
        setProgress(outcome.position);
      }
      // A native, non-passive listener is necessary: React's touch listeners are passive.
      // Only a claimed horizontal drag suppresses scrolling; the browser retains edge gestures.
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
    /** The page and the reveal settle together, so both take this one style. */
    style: {
      "--sidebar-progress": progress ?? (open ? 1 : 0),
      "--sidebar-duration": `${settling ? settle.duration : 300}ms`,
      // A tap opens or closes it along the drawer curve; a release continues the finger's own speed.
      "--sidebar-easing": settling ? settle.easing : "var(--ease-drawer)",
    } as CSSProperties,
    cancelDrag,
  };
}
