/**
 * What this browser remembers for one machine, and where: every machine's keys sit together under
 * its own prefix (`piano.machine.local.catalogs`, `piano.machine.eng-1.catalogs`), Local's like any
 * other's. One machine's memory is read at a glance, never seeds another's (identical directories
 * and IDs on two machines stay apart, INV-07), and leaves in one sweep when the machine is no
 * longer configured. The ID is the configured one: a renamed machine starts with nothing
 * remembered. Preferences that are this browser's own (the sidebar, the session rail) are not here.
 */
// Relative, not @shared: module tests load this file directly in Node.
import { isMachineId } from "../../../shared/machine.ts";
import { readStorage, writeStorage } from "./storage.ts";

/**
 * What is remembered per machine: its model catalogs, the New page's last directory, the Surface
 * area's open tabs, the folder and project groups left open in the sidebar (they are named by
 * the machine's own paths and IDs), and where the user was on it.
 */
export type MachineMemoryName = "catalogs" | "lastDir" | "surface" | "openGroups" | "location";

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
const browserText: TextStorage = { read: readStorage, write: writeStorage };

/**
 * Where the user was on a machine, as the path within it (`/s/<id>`, `/projects`), so switching
 * back opens there even after a reload. Anything stored that is not such a path reads as none.
 * The page may no longer exist (a session deleted since): it then says so, as any old link does.
 */
export function machineLocationMemory(machineId: string, storage: TextStorage = browserText) {
  const key = machineKey(machineId, "location");
  return {
    read: (): string | undefined => {
      const path = storage.read(key);
      return path && /^\/(?![/\\])/.test(path) && !path.startsWith("/m/") ? path : undefined;
    },
    write: (path: string) => storage.write(key, path),
  };
}

/** The machine a key belongs to; none for a key that is not a machine's. */
function keyMachine(key: string): string | undefined {
  if (!key.startsWith(PREFIX)) return undefined;
  const id = key.slice(PREFIX.length).split(".")[0];
  return isMachineId(id) ? id : undefined;
}

/**
 * Forget every machine this Piano no longer configures: all of its keys, in each of `stores`.
 * Call it only with a list the server answered, never after a failed read, so a lost connection
 * forgets nothing. An unavailable machine is still configured and keeps its memory.
 */
export function forgetUnconfiguredMachines(
  configured: ReadonlyArray<{ readonly id: string }>,
  stores: ReadonlyArray<Pick<Storage, "length" | "key" | "removeItem">> = browserStores(),
): void {
  const ids = new Set(configured.map((machine) => machine.id));
  for (const store of stores) {
    try {
      const stale = [...FORMER_KEYS];
      for (let index = 0; index < store.length; index++) {
        const key = store.key(index);
        const id = key === null ? undefined : keyMachine(key);
        if (key !== null && id !== undefined && !ids.has(id)) stale.push(key);
      }
      for (const key of stale) store.removeItem(key);
    } catch {
      /* storage unavailable: nothing was remembered there */
    }
  }
}

/** This browser's stores; either can be missing or blocked. */
function browserStores(): Storage[] {
  const stores: Storage[] = [];
  for (const read of [() => localStorage, () => sessionStorage]) {
    try {
      stores.push(read());
    } catch {
      /* blocked */
    }
  }
  return stores;
}
