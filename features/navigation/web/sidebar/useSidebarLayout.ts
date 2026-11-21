import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  browserSidebarEnvironment,
  createSidebarLayout,
  type SidebarLayout,
  type SidebarLayoutState,
} from "./sidebarLayout.ts";

export const SidebarLayoutContext = createContext<SidebarLayout | null>(null);

export function useSidebarLayoutController(): SidebarLayout {
  const [layout] = useState(() => createSidebarLayout(browserSidebarEnvironment));
  useEffect(() => layout.start(), [layout]);
  return layout;
}

export function useSidebarShortcut(): void {
  const layout = useSidebarLayout();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "b" &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        layout.toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [layout]);
}

export function useSidebarLayout(): SidebarLayout {
  const layout = useContext(SidebarLayoutContext);
  if (!layout) throw new Error("useSidebarLayout needs a SidebarLayoutContext provider");
  return layout;
}

export function useSidebarLayoutState(): SidebarLayoutState {
  const layout = useSidebarLayout();
  return useSyncExternalStore(layout.subscribe, layout.getState);
}
