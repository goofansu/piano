/**
 * What this browser remembers for one machine, and where: every machine's keys sit together under
 * its own prefix (`piano.machine.local.catalogs`, `piano.machine.eng-1.catalogs`), Local's like any
 * other's. One machine's memory is read at a glance, never seeds another's (identical directories
 * and IDs on two machines stay apart, INV-07), and leaves in one sweep when the machine is no
 * longer configured. The ID is the configured one: a renamed machine starts with nothing
 * remembered. Preferences that are this browser's own (the sidebar, the session rail) are not here.
 * docs/browser-storage.md has the rules for choosing a key and its store.
 */
// Relative, not @shared: module tests load this file directly in Node.
import { isMachineId } from "../../../shared/machine.ts";
import { readStorage, writeStorage } from "./storage.ts";

/**
 * Each thing remembered per machine and the store that holds it. What one browser tab is showing
 * (its open Surface tabs, the page it was on) lives with that tab in sessionStorage, so two tabs
 * never overwrite each other; what is worth having in every tab and next week (model catalogs,
 * the New page's last directory, the sidebar's open folder and project groups) is in localStorage.
 */
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
/** Where Local's memory lived before every machine had a prefix; removed, never read. */
const FORMER_KEYS = ["piano.catalogs", "piano.lastDir", "piano.surface", "piano.openProjects"];

/** The storage key holding `name` for `machineId`. */
export const machineKey = (machineId: string, name: MachineMemoryName) =>
  `${PREFIX}${machineId}.${name}`;

/** A string store, behind a seam so the rule runs in Node. */
export interface TextStorage {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
}
/** This tab's sessionStorage, which can be missing or blocked: a read falls back, a write is best effort. */
const tabText: TextStorage = {
  read: (key) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, value) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* storage unavailable: remembered for this page only */
    }
  },
};
const browserText: Record<StoreKind, TextStorage> = {
  local: { read: readStorage, write: writeStorage },
  session: tabText,
};

/**
 * Where the user was on a machine, as the path within it (`/s/<id>`, `/projects`), so switching
 * back opens there, also after a reload. It is this tab's: another tab keeps its own place.
 * Anything stored that is not such a path reads as none. The page may no longer exist (a session
 * deleted since): it then says so, as any old link does.
 */
export function machineLocationMemory(
  machineId: string,
  storage: TextStorage = browserText[MACHINE_MEMORY.location],
) {
  const key = machineKey(machineId, "location");
  return {
    read: (): string | undefined => {
      const path = storage.read(key);
      return path && /^\/(?![/\\])/.test(path) && !path.startsWith("/m/") ? path : undefined;
    },
    write: (path: string) => storage.write(key, path),
  };
}

/** The machine and memory a key names; none for a key that is not a machine's. */
function keyOwner(key: string): { id: string; name: string } | undefined {
  if (!key.startsWith(PREFIX)) return undefined;
  const [id, ...name] = key.slice(PREFIX.length).split(".");
  return isMachineId(id) ? { id, name: name.join(".") } : undefined;
}

type SweptStore = Pick<Storage, "length" | "key" | "removeItem">;

/**
 * Keep under the machine prefix only what belongs there: in each store, remove every key of a
 * machine this Piano no longer configures, every key `MACHINE_MEMORY` does not place in that
 * store (a name retired since, or one that moved to the other store), and Local's keys from
 * before the prefix. Call it only with a list the server answered, never after a failed read, so
 * a lost connection forgets nothing. An unavailable machine is still configured and keeps its memory.
 */
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
    } catch {
      /* storage unavailable: nothing was remembered there */
    }
  }
}

/** This browser's stores; either can be missing or blocked. */
function browserStores(): Partial<Record<StoreKind, Storage>> {
  const stores: Partial<Record<StoreKind, Storage>> = {};
  try {
    stores.local = localStorage;
  } catch {
    /* blocked */
  }
  try {
    stores.session = sessionStorage;
  } catch {
    /* blocked */
  }
  return stores;
}
