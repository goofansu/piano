import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { workspaceFile } from "./api.ts";
import {
  browserAddressBar,
  browserSurfaceMemory,
  createNavigation,
  type Navigation,
  type NavigationOptions,
  type NavigationState,
} from "./navigation.ts";
import { createPreference } from "./preference.ts";

const railPreference = createPreference<boolean>({
  key: "piano.details",
  decode: (raw) => raw === "true",
});

export const NavigationContext = createContext<Navigation | null>(null);

export function useNavigationController(
  client: NavigationOptions["client"],
  moved: () => void,
): Navigation {
  const [navigation] = useState(() =>
    createNavigation({
      client,
      address: browserAddressBar,
      readFile: workspaceFile,
      memory: browserSurfaceMemory(),
      rail: railPreference,
      moved,
    }),
  );
  useEffect(() => navigation.start(), [navigation]);
  return navigation;
}

export function useNavigation(): Navigation & NavigationState {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("useNavigation needs a NavigationContext provider");
  const state = useSyncExternalStore(navigation.subscribe, navigation.getState);
  return { ...navigation, ...state };
}
