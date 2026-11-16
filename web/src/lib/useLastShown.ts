import { useRef } from "react";

export function useLastShown<T>(value: T | undefined): T | undefined {
  const last = useRef(value);
  if (value !== undefined) last.current = value;
  return last.current;
}
