import { useEffect } from "react";
import type { Client } from "./client.ts";
import { sessionNavigationDirection } from "./keys.ts";
import type { Navigation } from "./navigation.ts";
import { adjacentSidebarSession, type SidebarList } from "./sidebarList.ts";

/** One machine-local listener over the same list the desktop and mobile sidebars render. */
export function useSidebarSessionNavigation(
  list: SidebarList,
  client: Pick<Client, "getState">,
  navigation: Navigation,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = sessionNavigationDirection(event);
      if (!direction || navigation.getState().settings || navigation.getState().palette) return;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [cmdk-root]',
        )
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.closest('form, [role="textbox"]')) &&
        !(target instanceof HTMLTextAreaElement && target.closest('[data-slot="session-composer"]'))
      )
        return;
      event.preventDefault();
      // select updates the client synchronously. Read it at the key, not from a render closure:
      // a second key can arrive before React commits or the first session finishes opening.
      const state = client.getState();
      const next = adjacentSidebarSession(list, state.session ?? state.selecting, direction);
      if (next) navigation.select(next.cwd, next.sessionId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, client, navigation]);
}
