import { useRef } from "react";

/**
 * An overlay animates closed after its state closes, so it shows the last open `value` meanwhile:
 * `value` while defined, otherwise the last defined one (undefined before it ever opened).
 */
export function useLastShown<T>(value: T | undefined): T | undefined {
  const last = useRef(value);
  if (value !== undefined) last.current = value;
  return last.current;
}
