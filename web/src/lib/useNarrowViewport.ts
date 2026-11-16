import { useEffect, useState } from "react";
import { isWideViewport, subscribeViewport } from "./viewportLayout.ts";

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
