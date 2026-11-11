import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetUnconfiguredMachines, machineKey } from "../web/src/lib/machineMemory.ts";

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
    (["catalogs", "lastDir", "surface"] as const).map((name) => machineKey(id, name)),
  );
  assert.equal(new Set(keys).size, 9, "no two machines, and no two memories, share a key");
  for (const id of ["local", "eng-1", "eng-10"])
    for (const key of keys.filter((k) => k === machineKey(id, "catalogs")))
      assert.ok(key.includes(`.${id}.`), "a machine's keys name it");
});

test("a machine no longer configured is forgotten whole; the rest of this browser is kept", () => {
  const kept = [
    machineKey("local", "catalogs"),
    machineKey("local", "lastDir"),
    machineKey("eng-1", "catalogs"),
    machineKey("eng-1", "surface"),
    // This browser's own preferences are no machine's.
    "piano.sidebarView",
    "piano.details",
    "another-app.machine.eng-2.catalogs",
  ];
  const gone = [
    machineKey("eng-2", "catalogs"),
    machineKey("eng-2", "lastDir"),
    machineKey("eng-2", "surface"),
    // eng-1 is configured; a machine whose ID merely starts the same is not.
    machineKey("eng-10", "catalogs"),
    // Where Local's memory lived before machines had prefixes.
    "piano.catalogs",
    "piano.lastDir",
    "piano.surface",
  ];
  const local = store([...kept, ...gone]);
  const session = store([machineKey("eng-2", "surface"), machineKey("eng-1", "surface")]);
  forgetUnconfiguredMachines([{ id: "local" }, { id: "eng-1" }], [local, session]);
  assert.deepEqual([...local.held.keys()].sort(), [...kept].sort());
  assert.deepEqual([...session.held.keys()], [machineKey("eng-1", "surface")]);
});

test("a store that cannot be read forgets nothing and does not stop the others", () => {
  const blocked = {
    get length(): number {
      throw new Error("blocked");
    },
    key: () => null,
    removeItem: () => {},
  };
  const open = store([machineKey("eng-2", "catalogs")]);
  forgetUnconfiguredMachines([{ id: "local" }], [blocked, open]);
  assert.deepEqual([...open.held.keys()], []);
});
