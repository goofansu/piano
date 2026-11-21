import { createContext, useContext, useSyncExternalStore } from "react";
import type { Navigation, NavigationState } from "./navigation.ts";
export const NavigationContext = createContext<Navigation | null>(null);

export function useNavigation(): Navigation & NavigationState {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("useNavigation needs a NavigationContext provider");
  const state = useSyncExternalStore(navigation.subscribe, navigation.getState);
  return { ...navigation, ...state };
}
