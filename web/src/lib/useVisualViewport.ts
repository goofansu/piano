import { useLayoutEffect, useRef } from "react";

/** Size the app to the visible area, not the layout viewport left behind by a mobile keyboard. */
export function useVisualViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const viewport = window.visualViewport;
    if (!element || !viewport) return;
    let frame = 0;
    const update = () => {
      // Pinch zoom should magnify/pan the existing layout, not reflow it or chase the user's pan.
      if (viewport.scale !== 1) return;
      element.style.setProperty("--app-viewport-height", `${viewport.height}px`);
      // Safari can pan the visual viewport as it brings the focused input above the keyboard.
      element.style.top = `${viewport.offsetTop}px`;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
    };
  }, []);
  return ref;
}
