import { isMachineId } from "../../../shared/machine.ts";
import {
  browserPreferenceStorage,
  createPreference,
  type Preference,
  type PreferenceOptions,
  type PreferenceStorage,
} from "./preference.ts";

export const MACHINE_MEMORY = {
  catalogs: "local",
  lastDir: "local",
  openGroups: "local",
  surface: "session",
  location: "session",
} as const satisfies Record<string, "local" | "session">;
export type MachineMemoryName = keyof typeof MACHINE_MEMORY;
type StoreKind = (typeof MACHINE_MEMORY)[MachineMemoryName];

const PREFIX = "piano.machine.";
const FORMER_KEYS = ["piano.catalogs", "piano.lastDir", "piano.surface", "piano.openProjects"];

export const machineKey = (machineId: string, name: MachineMemoryName) =>
  `${PREFIX}${machineId}.${name}`;

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

export interface MachineMemory {
  read: () => string | null;
  write: (value: string) => void;
  remove: () => void;
  preference: <T>(options: Omit<PreferenceOptions<T>, "key" | "storage">) => Preference<T>;
}

export function machineMemory(
  machineId: string,
  name: MachineMemoryName,
  storage: TextStorage = browserText[MACHINE_MEMORY[name]],
): MachineMemory {
  const key = machineKey(machineId, name);
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

export function machineLocationMemory(machineId: string, storage?: TextStorage) {
  const memory = machineMemory(machineId, "location", storage);
  return {
    read: (): string | undefined => {
      const path = memory.read();
      return path && /^\/(?![/\\])/.test(path) && !path.startsWith("/m/") ? path : undefined;
    },
    write: (path: string) => memory.write(path),
  };
}

function keyOwner(key: string): { id: string; name: string } | undefined {
  if (!key.startsWith(PREFIX)) return undefined;
  const [id, ...name] = key.slice(PREFIX.length).split(".");
  return isMachineId(id) ? { id, name: name.join(".") } : undefined;
}

type SweptStore = Pick<Storage, "length" | "key" | "removeItem">;

export function forgetUnconfiguredMachines(
  configured: ReadonlyArray<{ readonly id: string }>,
  stores: Partial<Record<StoreKind, SweptStore>> = browserStores(),
): void {
  const ids = new Set(configured.map((machine) => machine.id));
  const placed: Readonly<Record<string, StoreKind>> = MACHINE_MEMORY;
  for (const kind of ["local", "session"] as const) {
    const store = stores[kind];
    if (!store) continue;
    try {
      const stale = [...FORMER_KEYS];
      for (let index = 0; index < store.length; index++) {
        const key = store.key(index);
        const owner = key === null ? undefined : keyOwner(key);
        if (key !== null && owner && (!ids.has(owner.id) || placed[owner.name] !== kind))
          stale.push(key);
      }
      for (const key of stale) store.removeItem(key);
    } catch {}
  }
}

function browserStores(): Partial<Record<StoreKind, Storage>> {
  const stores: Partial<Record<StoreKind, Storage>> = {};
  try {
    stores.local = localStorage;
  } catch {}
  try {
    stores.session = sessionStorage;
  } catch {}
  return stores;
}
