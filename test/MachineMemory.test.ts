import assert from "node:assert/strict";
import { test } from "node:test";
import { storedLastDirectory } from "../web/src/lib/client.ts";
import {
  forgetUnconfiguredMachines,
  MACHINE_MEMORY,
  machineKey,
  machineLocationMemory,
} from "../web/src/lib/machineMemory.ts";
import { browserCatalogStorage } from "../web/src/lib/modelCatalogs.ts";
import { browserSurfaceMemory } from "../web/src/lib/navigation.ts";
import { sidebarPreferences } from "../web/src/lib/sidebarList.ts";

/** A whole browser store, for readers that use this browser's own. */
function browserStore() {
  const held = new Map<string, string>();
  return {
    held,
    get length() {
      return held.size;
    },
    key: (index: number) => [...held.keys()][index] ?? null,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, String(value)),
    removeItem: (key: string) => void held.delete(key),
  };
}

/** A browser store as the cleanup reads it. */
function store(keys: readonly string[]) {
  const held = new Map(keys.map((key) => [key, "value"]));
  return {
    held,
    get length() {
      return held.size;
    },
    key: (index: number) => [...held.keys()][index] ?? null,
    removeItem: (key: string) => void held.delete(key),
  };
}

test("each machine's memory has its own keys, Local's like any other's", () => {
  const keys = ["local", "eng-1", "eng-10"].flatMap((id) =>
    (["catalogs", "lastDir", "surface", "openGroups", "location"] as const).map((name) =>
      machineKey(id, name),
    ),
  );
  assert.equal(new Set(keys).size, 15, "no two machines, and no two memories, share a key");
  for (const id of ["local", "eng-1", "eng-10"])
    for (const key of keys.filter((k) => k === machineKey(id, "catalogs")))
      assert.ok(key.includes(`.${id}.`), "a machine's keys name it");
});

test("a machine no longer configured is forgotten whole; the rest of this browser is kept", () => {
  const kept = [
    machineKey("local", "catalogs"),
    machineKey("local", "lastDir"),
    machineKey("eng-1", "catalogs"),
    machineKey("eng-1", "openGroups"),
    // This browser's own preferences are no machine's.
    "piano.sidebarView",
    "piano.details",
    "another-app.machine.eng-2.catalogs",
  ];
  const gone = [
    machineKey("eng-2", "catalogs"),
    machineKey("eng-2", "lastDir"),
    machineKey("eng-2", "openGroups"),
    // eng-1 is configured; a machine whose ID merely starts the same is not.
    machineKey("eng-10", "catalogs"),
    // Where Local's memory lived before machines had prefixes.
    "piano.catalogs",
    "piano.lastDir",
    "piano.surface",
    "piano.openProjects",
  ];
  const local = store([...kept, ...gone]);
  const session = store([
    machineKey("eng-2", "surface"),
    machineKey("eng-2", "location"),
    machineKey("eng-1", "surface"),
    machineKey("eng-1", "location"),
  ]);
  forgetUnconfiguredMachines([{ id: "local" }, { id: "eng-1" }], { local, session });
  assert.deepEqual([...local.held.keys()].sort(), [...kept].sort());
  assert.deepEqual(
    [...session.held.keys()].sort(),
    [machineKey("eng-1", "location"), machineKey("eng-1", "surface")].sort(),
  );
});

test("a configured machine keeps each memory only in the store it belongs to", () => {
  // What a tab is showing is the tab's; what outlives it is the browser's. A key left in the
  // other store (where it lived before it moved), or under a name no longer remembered, goes.
  const local = store([
    machineKey("eng-1", "catalogs"),
    machineKey("eng-1", "location"),
    machineKey("eng-1", "surface"),
    "piano.machine.eng-1.retired",
  ]);
  const session = store([
    machineKey("eng-1", "location"),
    machineKey("eng-1", "surface"),
    machineKey("eng-1", "catalogs"),
  ]);
  forgetUnconfiguredMachines([{ id: "local" }, { id: "eng-1" }], { local, session });
  assert.deepEqual([...local.held.keys()], [machineKey("eng-1", "catalogs")]);
  assert.deepEqual(
    [...session.held.keys()].sort(),
    [machineKey("eng-1", "location"), machineKey("eng-1", "surface")].sort(),
  );
});

test("what every reader remembers for a configured machine survives the sweep", (t) => {
  // Each reader writes through this browser's stores; the sweep removes a machine key from any
  // store MACHINE_MEMORY does not name, so a reader whose store disagreed would lose it on load.
  const stores = { local: browserStore(), session: browserStore() };
  for (const [name, value] of [
    ["localStorage", stores.local],
    ["sessionStorage", stores.session],
  ] as const) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (before) Object.defineProperty(globalThis, name, before);
      else delete (globalThis as Record<string, unknown>)[name];
    });
  }
  const catalogs = { "/repo": { models: [] } } as never;
  const remember = {
    catalogs: () => browserCatalogStorage("eng-1").write(catalogs),
    lastDir: () => storedLastDirectory("eng-1").write("/repo"),
    openGroups: () => sidebarPreferences(undefined, "eng-1").openGroups.set(["/repo"]),
    surface: () => browserSurfaceMemory("eng-1").write("surface"),
    location: () => machineLocationMemory("eng-1").write("/s/1"),
  } satisfies Record<keyof typeof MACHINE_MEMORY, () => void>;
  for (const write of Object.values(remember)) write();
  for (const [name, kind] of Object.entries(MACHINE_MEMORY))
    assert.ok(stores[kind].held.has(`piano.machine.eng-1.${name}`), `${name} is in ${kind}Storage`);

  forgetUnconfiguredMachines([{ id: "local" }, { id: "eng-1" }], stores);
  assert.deepEqual(browserCatalogStorage("eng-1").read(), catalogs);
  assert.equal(storedLastDirectory("eng-1").read(), "/repo");
  assert.deepEqual(sidebarPreferences(undefined, "eng-1").openGroups.get(), ["/repo"]);
  assert.equal(browserSurfaceMemory("eng-1").read(), "surface");
  assert.equal(machineLocationMemory("eng-1").read(), "/s/1");
  browserSurfaceMemory("eng-1").write(null);
  assert.equal(browserSurfaceMemory("eng-1").read(), null, "a closed surface is forgotten");
});

test("a store that cannot be read forgets nothing and does not stop the other", () => {
  const blocked = {
    get length(): number {
      throw new Error("blocked");
    },
    key: () => null,
    removeItem: () => {},
  };
  const open = store([machineKey("eng-2", "surface")]);
  forgetUnconfiguredMachines([{ id: "local" }], { local: blocked, session: open });
  assert.deepEqual([...open.held.keys()], []);
  // A store this browser does not have at all is skipped.
  forgetUnconfiguredMachines([{ id: "local" }], { session: open });
});

test("where the user was on a machine is its own, and only a path within a machine is read back", () => {
  const held = new Map<string, string>();
  const storage = {
    read: (key: string) => held.get(key) ?? null,
    write: (key: string, value: string) => void held.set(key, value),
  };
  const local = machineLocationMemory("local", storage);
  const remote = machineLocationMemory("eng-1", storage);
  assert.equal(remote.read(), undefined, "nothing remembered yet");
  local.write("/projects");
  remote.write("/s/same-session");
  assert.equal(local.read(), "/projects");
  assert.equal(remote.read(), "/s/same-session", "the same session ID elsewhere is another place");
  // Storage is the browser's, not Piano's: what is not a path within a machine opens nothing.
  for (const stored of [
    "",
    "new",
    "//evil.example/s/1",
    "/\\evil.example",
    "/m/eng-2/s/1",
    "https://evil.example",
  ]) {
    remote.write(stored);
    assert.equal(remote.read(), undefined, JSON.stringify(stored));
  }
});
