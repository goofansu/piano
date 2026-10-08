import { useSyncExternalStore } from "react";
import { DEFAULT_SIDEBAR_VIEW, type SidebarView } from "@/lib/sidebarView";

/** Remembered like the sidebar's open groups: per browser. */
const KEY = "piano.sidebarView";
const load = (): SidebarView => {
  try {
    return { ...DEFAULT_SIDEBAR_VIEW, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SidebarView>) };
  } catch {
    return DEFAULT_SIDEBAR_VIEW;
  }
};
let view = load();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const storage = (event: StorageEvent) => { if (event.key === KEY) { view = load(); listener(); } };
  window.addEventListener("storage", storage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", storage); };
};
const setView = (change: Partial<SidebarView>) => {
  const next = { ...view, ...change };
  if (next.groupBy === view.groupBy && next.sortBy === view.sortBy) return;
  view = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener();
};

/** The sidebar's grouping and sort, shared by every sidebar instance and the command palette. */
export function useSidebarView() {
  return { view: useSyncExternalStore(subscribe, () => view, () => view), setView };
}
