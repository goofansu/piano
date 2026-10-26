import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  browserAddressBar,
  browserSurfaceMemory,
  createNavigation,
  type Navigation,
  type NavigationOptions,
  type NavigationState,
} from "./navigation.ts";
import { createPreference } from "./preference.ts";

/** Whether the session rail is on, for every session in this browser. The key predates the name. */
const railPreference = createPreference<boolean>({
  key: "piano.details",
  decode: (raw) => raw === "true",
});

export const NavigationContext = createContext<Navigation | null>(null);

/** One navigation for the page over the real address bar, following it while mounted. */
export function useNavigationController(
  client: NavigationOptions["client"],
  moved: () => void,
): Navigation {
  const [navigation] = useState(() =>
    createNavigation({
      client,
      address: browserAddressBar,
      memory: browserSurfaceMemory,
      rail: railPreference,
      moved,
    }),
  );
  useEffect(() => navigation.start(), [navigation]);
  return navigation;
}

/** What is on screen and the moves that change it; any component under the provider calls them directly. */
export function useNavigation(): Navigation & NavigationState {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("useNavigation needs a NavigationContext provider");
  const state = useSyncExternalStore(navigation.subscribe, navigation.getState);
  return { ...navigation, ...state };
}
