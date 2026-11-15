import { useEffect, useLayoutEffect, useRef } from "react";
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
  const editing = useRef<{ element: HTMLTextAreaElement; selectionId: string | null } | null>(null);
  // Loading disables the composer, which makes the browser drop its focus. Restore only the
  // editor this chord came from, after the latest selection commits; never focus a sidebar row.
  useLayoutEffect(() => {
    const pending = editing.current;
    if (!pending) return;
    const state = client.getState();
    if (state.selectionId !== pending.selectionId) editing.current = null;
    else if (!state.selecting) {
      editing.current = null;
      if (
        state.session &&
        pending.element.isConnected &&
        !pending.element.disabled &&
        !pending.element.closest("[inert]") &&
        document.activeElement === document.body
      )
        pending.element.focus({ preventScroll: true });
    }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = sessionNavigationDirection(event);
      if (!direction) editing.current = null;
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
      if (next) {
        if (
          target instanceof HTMLTextAreaElement &&
          target.closest('[data-slot="session-composer"]')
        )
          editing.current = { element: target, selectionId: null };
        navigation.select(next.cwd, next.sessionId);
        if (editing.current) editing.current.selectionId = client.getState().selectionId;
      }
    };
    const stopEditing = () => {
      editing.current = null;
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target !== editing.current?.element) stopEditing();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", stopEditing);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", stopEditing);
      window.removeEventListener("focusin", onFocus);
    };
  }, [list, client, navigation]);
}
