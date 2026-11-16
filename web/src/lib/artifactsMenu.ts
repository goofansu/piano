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
