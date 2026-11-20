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

let preferences: SidebarPreferences | undefined;

export function useSidebarList(
  state: AppState,
  view: SidebarView,
): { list: SidebarList; toggle: (key: string, open: boolean) => void } {
  const [model] = useState(() =>
    createSidebarList({
      clock: browserSidebarClock,
      preferences: (preferences ??= sidebarPreferences()),
    }),
  );
  useEffect(() => model.start(), [model]);
  useEffect(() => model.sync(state, view), [model, state, view]);
  const list = useSyncExternalStore(model.subscribe, () => model.list(state, view));
  return { list, toggle: model.toggle };
}
