import { useSyncExternalStore } from "react";
import { DEFAULT_SIDEBAR_SORT, type SidebarSection, type SidebarSort } from "@/lib/sidebarSort";

/** Remembered like the sidebar's fold state: per browser, only the sections set away from the default. */
const KEY = "piano.sidebarSort";
type Sorts = Partial<Record<SidebarSection, SidebarSort>>;
const load = (): Sorts => {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Sorts) ?? {};
  } catch {
    return {};
  }
};
let sorts = load();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const storage = (event: StorageEvent) => { if (event.key === KEY) { sorts = load(); listener(); } };
  window.addEventListener("storage", storage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", storage); };
};
const setSort = (section: SidebarSection, sort: SidebarSort) => {
  if ((sorts[section] ?? DEFAULT_SIDEBAR_SORT) === sort) return;
  sorts = { ...sorts, [section]: sort };
  try {
    localStorage.setItem(KEY, JSON.stringify(sorts));
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener();
};

/** The sidebar sections' sort choices, shared by every sidebar instance and the command palette. */
export function useSidebarSort() {
  const current = useSyncExternalStore(subscribe, () => sorts, () => sorts);
  return { sort: (section: SidebarSection): SidebarSort => current[section] ?? DEFAULT_SIDEBAR_SORT, setSort };
}
