import { useEffect, useState } from "react";
import { HEADER_NARROW_VIEWPORT_QUERY, VIEWPORT_BREAKPOINT } from "./viewportLayout.ts";

/**
 * Header presentation only. Preserve the former upstream hook's false first render, innerWidth
 * read and max-width subscription; normalizing to the sidebar's min-width query would change
 * fractional-width semantics. Subscribe to the viewport itself: a sidebar state snapshot need
 * not change when its breakpoint crosses with no reveal or resize in progress.
 */
export function useNarrowViewport(): boolean {
  const [narrowViewport, setNarrowViewport] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(HEADER_NARROW_VIEWPORT_QUERY);
    const update = () => setNarrowViewport(window.innerWidth < VIEWPORT_BREAKPOINT);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  return narrowViewport;
}
