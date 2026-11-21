import { useEffect, useLayoutEffect, useRef } from "react";
import type { Client } from "../../../app/client.ts";
import { sessionNavigationKey, shortcutBlocked } from "../../../shared/lib/keys.ts";
import type { Navigation } from "../navigation.ts";
import { adjacentSidebarSession, type SidebarList } from "./sidebarList.ts";

const SESSION_COMPOSER = '[data-slot="session-composer"]';

const sessionComposer = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement && target.closest(SESSION_COMPOSER) ? target : null;

export function useSidebarSessionNavigation(
  list: SidebarList,
  client: Pick<Client, "getState">,
  navigation: Navigation,
): void {
  const editing = useRef<{ element: HTMLTextAreaElement; selectionId: string | null } | null>(null);
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
      const key = sessionNavigationKey(event);
      if (key === "modifier") return;
      if (!key) editing.current = null;
      if (!key || navigation.getState().settings || navigation.getState().palette) return;
      if (shortcutBlocked(event.target, { composer: SESSION_COMPOSER })) return;
      event.preventDefault();
      const composer = sessionComposer(event.target);
      const state = client.getState();
      const next = adjacentSidebarSession(list, state.session ?? state.selecting, key);
      if (next) {
        if (composer) editing.current = { element: composer, selectionId: null };
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
