import { useSyncExternalStore } from "react";
import type { Preference } from "./preference.ts";

export function usePreference<T>(preference: Preference<T>) {
  const value = useSyncExternalStore(preference.subscribe, preference.get, preference.get);
  return [value, preference.set] as const;
}
