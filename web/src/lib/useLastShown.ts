import { useRef } from "react";

/**
 * An overlay rendered from a value its state clears on close stays mounted once shown, so it can
 * animate closed: `value` while defined, otherwise the last defined one (undefined before it ever
 * opened). What the closing overlay shows is the content wrappers' job (`useExitFace`); this only
 * keeps its props, such as the key that starts a fresh attempt per opening.
 */
export function useLastShown<T>(value: T | undefined): T | undefined {
  const last = useRef(value);
  if (value !== undefined) last.current = value;
  return last.current;
}
