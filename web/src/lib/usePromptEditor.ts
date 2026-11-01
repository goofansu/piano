import { useEffect, useSyncExternalStore } from "react";

/**
 * The page's one prompt editor, so New prompt opens the same dialog whether the Prompts header or
 * the command palette ran it.
 */
export const promptEditor = (() => {
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

/** Whether the editor is open while the Prompts page is mounted; leaving the page closes it. */
export function usePromptEditor() {
  useEffect(() => promptEditor.close, []);
  return useSyncExternalStore(promptEditor.subscribe, promptEditor.getState);
}
