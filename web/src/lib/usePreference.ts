import { useSyncExternalStore } from "react";
import type { Preference } from "./preference.ts";

/** A browser preference's value and setter; re-renders when this page or another tab changes it. */
export function usePreference<T>(preference: Preference<T>) {
  const value = useSyncExternalStore(preference.subscribe, preference.get, preference.get);
  return [value, preference.set] as const;
}
