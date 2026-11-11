import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppState } from "../store.ts";
import {
  browserSidebarClock,
  createSidebarList,
  type SidebarList,
  type SidebarPreferences,
  sidebarPreferences,
} from "./sidebarList.ts";
import type { SidebarView } from "./sidebarView.ts";
import { useMachineId } from "./useMachine.ts";

/** Shared by every mount for one machine, so a sidebar that remounts reads what the last one left open. */
const preferences = new Map<string, SidebarPreferences>();
function preferencesFor(machineId: string): SidebarPreferences {
  let own = preferences.get(machineId);
  if (!own) preferences.set(machineId, (own = sidebarPreferences(undefined, machineId)));
  return own;
}

/** The sidebar list for this state and view over the real clock and storage, following them while mounted. */
export function useSidebarList(
  state: AppState,
  view: SidebarView,
): { list: SidebarList; toggle: (key: string, open: boolean) => void } {
  const machineId = useMachineId();
  const [model] = useState(() =>
    createSidebarList({ clock: browserSidebarClock, preferences: preferencesFor(machineId) }),
  );
  useEffect(() => model.start(), [model]);
  useEffect(() => model.sync(state, view), [model, state, view]);
  const list = useSyncExternalStore(model.subscribe, () => model.list(state, view));
  return { list, toggle: model.toggle };
}
