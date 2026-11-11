import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { workspaceFile } from "./api.ts";
import { LOCAL, machineAddress } from "./machine.ts";
import {
  browserAddressBar,
  browserSurfaceMemory,
  createNavigation,
  type Navigation,
  type NavigationOptions,
  type NavigationState,
} from "./navigation.ts";
import { createPreference } from "./preference.ts";
import { useMachine } from "./useMachine.ts";

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
  const machine = useMachine()?.machine;
  const machineId = machine?.id ?? LOCAL.id;
  const [navigation] = useState(() =>
    createNavigation({
      client,
      address: machine ? machineAddress(machine.id, browserAddressBar) : browserAddressBar,
      // Each machine's files and remembered tabs are its own: IDs may collide across machines.
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

/** What is on screen and the moves that change it; any component under the provider calls them directly. */
export function useNavigation(): Navigation & NavigationState {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("useNavigation needs a NavigationContext provider");
  const state = useSyncExternalStore(navigation.subscribe, navigation.getState);
  return { ...navigation, ...state };
}
