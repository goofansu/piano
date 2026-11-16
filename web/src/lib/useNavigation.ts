import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { workspaceFile } from "./api.ts";
import { machineAddress } from "./machine.ts";
import {
  browserAddressBar,
  browserSurfaceMemory,
  createNavigation,
  type Navigation,
  type NavigationOptions,
  type NavigationState,
} from "./navigation.ts";
import { createPreference } from "./preference.ts";
import { useMachineId } from "./useMachine.ts";

const railPreference = createPreference<boolean>({
  key: "piano.details",
  decode: (raw) => raw === "true",
});

export const NavigationContext = createContext<Navigation | null>(null);

export function useNavigationController(
  client: NavigationOptions["client"],
  moved: () => void,
): Navigation {
  const machineId = useMachineId();
  const [navigation] = useState(() =>
    createNavigation({
      client,
      address: machineAddress(machineId, browserAddressBar),
      readFile: (workspaceId, path, options) =>
        workspaceFile(workspaceId, path, { ...options, machineId }),
      memory: browserSurfaceMemory(machineId),
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
