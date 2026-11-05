import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  browserSidebarEnvironment,
  createSidebarLayout,
  type SidebarLayout,
  type SidebarLayoutState,
} from "./sidebarLayout.ts";

export const SidebarLayoutContext = createContext<SidebarLayout | null>(null);

/** One sidebar layout for the page over the real breakpoint and storage, following it while mounted. */
export function useSidebarLayoutController(): SidebarLayout {
  const [layout] = useState(() => createSidebarLayout(browserSidebarEnvironment));
  useEffect(() => layout.start(), [layout]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+B alone, including repeated keydowns, as in the patched stock provider.
      // Route through the same CSS-aligned column/reveal controller as buttons and the palette.
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
  return layout;
}

/** Show, hide and toggle the sidebar from anywhere under the provider, without re-rendering on its state. */
export function useSidebarLayout(): SidebarLayout {
  const layout = useContext(SidebarLayoutContext);
  if (!layout) throw new Error("useSidebarLayout needs a SidebarLayoutContext provider");
  return layout;
}

/** The sidebar's state, for the surfaces that draw it. */
export function useSidebarLayoutState(): SidebarLayoutState {
  const layout = useSidebarLayout();
  return useSyncExternalStore(layout.subscribe, layout.getState);
}
