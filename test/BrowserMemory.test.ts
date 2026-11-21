import assert from "node:assert/strict";
import { test } from "node:test";
import { storedLastDirectory } from "../web/src/app/client.ts";
import { browserCatalogStorage } from "../web/src/features/models/modelCatalogs.ts";
import { browserSurfaceMemory } from "../web/src/features/navigation/navigation.ts";
import { sidebarPreferences } from "../web/src/features/navigation/sidebar/sidebarList.ts";
import { BROWSER_MEMORY, browserMemory } from "../web/src/shared/lib/browserMemory.ts";

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

test("each memory is kept under piano.<name> in its own store and read back from it", (t) => {
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
    catalogs: () => browserCatalogStorage().write(catalogs),
    lastDir: () => storedLastDirectory().write("/repo"),
    openGroups: () => sidebarPreferences().openGroups.set(["/repo"]),
    surface: () => browserSurfaceMemory().write("surface"),
  } satisfies Record<keyof typeof BROWSER_MEMORY, () => void>;
  for (const write of Object.values(remember)) write();
  for (const [name, kind] of Object.entries(BROWSER_MEMORY)) {
    const other = kind === "local" ? "session" : "local";
    assert.ok(stores[kind].held.has(`piano.${name}`), `${name} is in ${kind}Storage`);
    assert.ok(!stores[other].held.has(`piano.${name}`), `${name} is not in ${other}Storage`);
  }

  assert.deepEqual(browserCatalogStorage().read(), catalogs);
  assert.equal(storedLastDirectory().read(), "/repo");
  assert.deepEqual(sidebarPreferences().openGroups.get(), ["/repo"]);
  assert.equal(browserSurfaceMemory().read(), "surface");
  browserSurfaceMemory().write(null);
  assert.equal(browserSurfaceMemory().read(), null, "a closed surface is forgotten");
});

test("storage that cannot be read or written reads as nothing remembered", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  const memory = browserMemory("lastDir", { read: blocked, write: blocked, remove: blocked });
  assert.equal(memory.read(), null);
  memory.write("/repo");
  memory.remove();
  assert.equal(memory.read(), null);
});
