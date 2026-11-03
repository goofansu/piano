/**
 * The palette's Artifacts command asks the session header to open its Artifacts menu; the header
 * owns the menu, so the request is only a signal.
 */
export const artifactsMenu = (() => {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: () => {
      for (const listener of listeners) listener();
    },
  };
})();
