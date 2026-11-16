export interface PreferenceStorage {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  onChange: (listener: (key: string | null) => void) => () => void;
}

export interface PreferenceOptions<T> {
  key: string;
  decode: (raw: string | null) => T;
  encode?: (value: T) => string;
  storage?: PreferenceStorage;
}

export interface Preference<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export const browserPreferenceStorage: PreferenceStorage = {
  read: (key) => localStorage.getItem(key),
  write: (key, value) => localStorage.setItem(key, value),
  onChange: (listener) => {
    const onStorage = (event: StorageEvent) => listener(event.key);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
};

export function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function createPreference<T>({
  key,
  decode,
  encode = JSON.stringify,
  storage = browserPreferenceStorage,
}: PreferenceOptions<T>): Preference<T> {
  const listeners = new Set<() => void>();
  let loaded = false;
  let value: T;
  let encoded: string;

  const read = (): string | null => {
    try {
      return storage.read(key);
    } catch {
      return null;
    }
  };
  const adopt = (next: T) => {
    const text = encode(next);
    if (loaded && text === encoded) return false;
    value = next;
    encoded = text;
    return true;
  };
  const load = () => {
    if (loaded) return;
    adopt(decode(read()));
    loaded = true;
    try {
      storage.onChange((changed) => {
        if (changed !== key && changed !== null) return;
        if (adopt(decode(read()))) for (const listener of listeners) listener();
      });
    } catch {}
  };

  return {
    get: () => {
      load();
      return value;
    },
    set: (next) => {
      load();
      if (!adopt(next)) return;
      try {
        storage.write(key, encoded);
      } catch {}
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      load();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
