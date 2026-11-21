import { type ReactNode, useEffect, useSyncExternalStore } from "react";

export interface EditorOpen<Entry> {
  target: Entry | "new";
  key: number;
}

export type Editing<Entry> = EditorOpen<Entry> | null;

export interface PageEditor<Entry> {
  getState: () => Editing<Entry>;
  subscribe: (listener: () => void) => () => void;
  open: (target: Entry | "new") => void;
  close: () => void;
  useEditing: () => Editing<Entry>;
  available: () => boolean;
  useAvailable: (available: boolean) => void;
}

export function pageEditor<Entry = never>(): PageEditor<Entry> {
  let editing: Editing<Entry> = null;
  let opens = 0;
  let available = true;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const set = (next: Editing<Entry>) => {
    editing = next;
    notify();
  };
  const setAvailable = (next: boolean) => {
    if (available === next) return;
    available = next;
    notify();
  };
  const getState = () => editing;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const close = () => set(null);
  return {
    getState,
    subscribe,
    open: (target) => set({ target, key: ++opens }),
    close,
    useEditing: () => {
      useEffect(() => close, []);
      return useSyncExternalStore(subscribe, getState);
    },
    available: () => available,
    useAvailable: (next) => {
      useEffect(() => setAvailable(next), [next]);
      useEffect(() => () => setAvailable(true), []);
    },
  };
}

export interface PageEditorProps<Entry = never> {
  editor: PageEditor<Entry>;
  headerActions: ReactNode;
}
