import { useEffect, useState } from "react";
import { isWideViewport, subscribeViewport } from "./viewportLayout.ts";

/**
 * Header presentation only. Keep the false first render for startup/hidden layout fallback;
 * after mounting, narrow is exactly the complement of the application's CSS-aligned query.
 */
export function useNarrowViewport(): boolean {
  const [narrowViewport, setNarrowViewport] = useState(false);
  useEffect(() => {
    const update = () => setNarrowViewport(!isWideViewport());
    const stop = subscribeViewport(update);
    update();
    return stop;
  }, []);
  return narrowViewport;
}
