import { useEffect, useSyncExternalStore } from "react";

/**
 * The page's one skill editor, so New skill opens the same dialog whether the Skills header or the
 * command palette ran it.
 */
export const skillEditor = (() => {
  let open = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    open = next;
    for (const listener of listeners) listener();
  };
  return {
    getState: () => open,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: () => set(true),
    close: () => set(false),
  };
})();

/** Whether the editor is open while the Skills page is mounted; leaving the page closes it. */
export function useSkillEditor() {
  useEffect(() => skillEditor.close, []);
  return useSyncExternalStore(skillEditor.subscribe, skillEditor.getState);
}
