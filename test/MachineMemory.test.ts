import assert from "node:assert/strict";
import { test } from "node:test";
import {
  forgetUnconfiguredMachines,
  machineKey,
  machineLocationMemory,
} from "../web/src/lib/machineMemory.ts";

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
    "piano.openProjects",
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
