/**
 * One per-browser preference: a value remembered in storage under a fixed key, shared by every
 * reader on the page and kept in step with other tabs. Storage can be missing or blocked (private
 * windows, embedded webviews, cleared site data), so a stored value that is absent or does not
 * decode reads as the fallback, and a failed write keeps the value for this page only.
 * Nothing here depends on React; `usePreference` binds one to a component.
 */

/** Where preferences live, behind a seam so the policy runs in Node. Any call may throw. */
export interface PreferenceStorage {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  /** Another tab changed `key`, or cleared everything (`null`); returns the unsubscribe function. */
  onChange: (listener: (key: string | null) => void) => () => void;
}

export interface PreferenceOptions<T> {
  /** Stored under this key; changing it forgets what users saved. */
  key: string;
  /** The stored text, or `null` when there is none, to a value; anything unexpected is the fallback. */
  decode: (raw: string | null) => T;
  /** Defaults to JSON. Values that encode alike are the same preference, so setting one is a no-op. */
  encode?: (value: T) => string;
  storage?: PreferenceStorage;
}

export interface Preference<T> {
  get: () => T;
  set: (value: T) => void;
  /** Called after the value changes on this page or in another tab; returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}

/** The real localStorage and `storage` event. Globals are read only when called, so this module loads in Node. */
export const browserPreferenceStorage: PreferenceStorage = {
  read: (key) => localStorage.getItem(key),
  write: (key, value) => localStorage.setItem(key, value),
  onChange: (listener) => {
    const onStorage = (event: StorageEvent) => listener(event.key);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
};

/** Parses stored JSON, or `undefined` when it is absent or malformed, for `decode` to check. */
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
  // Loaded on first use, then followed for the page's life: other tabs' changes arrive even while
  // nothing is subscribed, so a later reader never sees a stale value.
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
    } catch {
      /* no change events: other tabs' changes show on the next page load */
    }
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
      } catch {
        /* storage unavailable: the preference lasts for this page only */
      }
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
