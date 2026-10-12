import { useSyncExternalStore } from "react";
import { DEFAULT_SIDEBAR_VIEW, type SidebarView } from "@/lib/sidebarView";
import { readJson, writeJson } from "@/lib/storage";

/** Remembered like the sidebar's open groups: per browser. */
const KEY = "piano.sidebarView";
const load = (): SidebarView => ({
  ...DEFAULT_SIDEBAR_VIEW,
  ...readJson<Partial<SidebarView>>(KEY, {}),
});
let view = load();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === KEY) {
      view = load();
      listener();
    }
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
};
const setView = (change: Partial<SidebarView>) => {
  const next = { ...view, ...change };
  if (next.groupBy === view.groupBy && next.sortBy === view.sortBy) return;
  view = next;
  writeJson(KEY, view);
  for (const listener of listeners) listener();
};

/** The sidebar's grouping and sort, shared by every sidebar instance and the command palette. */
export function useSidebarView() {
  return {
    view: useSyncExternalStore(
      subscribe,
      () => view,
      () => view,
    ),
    setView,
  };
}
