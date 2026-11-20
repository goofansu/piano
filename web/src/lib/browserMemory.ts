import {
  browserPreferenceStorage,
  createPreference,
  type Preference,
  type PreferenceOptions,
  type PreferenceStorage,
} from "./preference.ts";

export const BROWSER_MEMORY = {
  catalogs: "local",
  lastDir: "local",
  openGroups: "local",
  surface: "session",
} as const satisfies Record<string, "local" | "session">;
export type BrowserMemoryName = keyof typeof BROWSER_MEMORY;
type StoreKind = (typeof BROWSER_MEMORY)[BrowserMemoryName];

const memoryKey = (name: BrowserMemoryName) => `piano.${name}`;

export interface TextStorage {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove?: (key: string) => void;
  onChange?: PreferenceStorage["onChange"];
}

const browserText: Record<StoreKind, TextStorage> = {
  local: { ...browserPreferenceStorage, remove: (key) => localStorage.removeItem(key) },
  session: {
    read: (key) => sessionStorage.getItem(key),
    write: (key, value) => sessionStorage.setItem(key, value),
    remove: (key) => sessionStorage.removeItem(key),
  },
};

export interface BrowserMemory {
  read: () => string | null;
  write: (value: string) => void;
  remove: () => void;
  preference: <T>(options: Omit<PreferenceOptions<T>, "key" | "storage">) => Preference<T>;
}

export function browserMemory(
  name: BrowserMemoryName,
  storage: TextStorage = browserText[BROWSER_MEMORY[name]],
): BrowserMemory {
  const key = memoryKey(name);
  return {
    read: () => {
      try {
        return storage.read(key);
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        storage.write(key, value);
      } catch {}
    },
    remove: () => {
      try {
        storage.remove?.(key);
      } catch {}
    },
    preference: (options) =>
      createPreference({
        ...options,
        key,
        storage: {
          read: (stored) => storage.read(stored),
          write: (stored, value) => storage.write(stored, value),
          onChange: (listener) => storage.onChange?.(listener) ?? (() => {}),
        },
      }),
  };
}
