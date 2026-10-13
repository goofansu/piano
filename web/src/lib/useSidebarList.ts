import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppState } from "../store.ts";
import {
  browserSidebarClock,
  createSidebarList,
  type SidebarList,
  sidebarPreferences,
} from "./sidebarList.ts";
import type { SidebarView } from "./sidebarView.ts";

/** Shared by every mount, so a sidebar that remounts reads what the last one left open. */
const preferences = sidebarPreferences();

/** The sidebar list for this state and view over the real clock and storage, following them while mounted. */
export function useSidebarList(
  state: AppState,
  view: SidebarView,
): { list: SidebarList; toggle: (key: string, open: boolean) => void } {
  const [model] = useState(() => createSidebarList({ clock: browserSidebarClock, preferences }));
  useEffect(() => model.start(), [model]);
  useEffect(() => model.sync(state, view), [model, state, view]);
  const list = useSyncExternalStore(model.subscribe, () => model.list(state, view));
  return { list, toggle: model.toggle };
}
