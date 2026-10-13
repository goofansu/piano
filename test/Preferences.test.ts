import assert from "node:assert/strict";
import { test } from "node:test";
import { createPreference, type PreferenceStorage, parseJson } from "../web/src/lib/preference.ts";

/** One browser's storage, shared by tabs. `otherTab` writes as another tab would, then announces it. */
function browser(stored: Record<string, string> = {}, { available = true } = {}) {
  const items = new Map(Object.entries(stored));
  const changeListeners = new Set<(key: string | null) => void>();
  const writes: Array<[string, string]> = [];
  const unavailable = () => {
    if (!available) throw new Error("SecurityError: storage is blocked");
  };
  const storage: PreferenceStorage = {
    read: (key) => {
      unavailable();
      return items.get(key) ?? null;
    },
    write: (key, value) => {
      unavailable();
      writes.push([key, value]);
      items.set(key, value);
    },
    onChange: (listener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };
  return {
    storage,
    items,
    writes,
    otherTab: {
      write: (key: string, value: string) => {
        items.set(key, value);
        for (const listener of changeListeners) listener(key);
      },
      clear: () => {
        items.clear();
        for (const listener of changeListeners) listener(null);
      },
    },
  };
}

/** Shaped like the sidebar's pinned group: JSON, open unless the user closed it. */
const pinnedOpen = (storage: PreferenceStorage) =>
  createPreference<boolean>({
    key: "piano.pinnedOpen",
    decode: (raw) => parseJson(raw) !== false,
    storage,
  });

/** Shaped like the composer's queue mode: plain text, one of two values. */
const queueMode = (storage: PreferenceStorage) =>
  createPreference<"steering" | "follow-up">({
    key: "piano.queueMode",
    decode: (raw) => (raw === "follow-up" ? "follow-up" : "steering"),
    encode: (mode) => mode,
    storage,
  });

test("a saved value reads back unchanged and a set stores the same encoding", () => {
  const page = browser({ "piano.pinnedOpen": "false", "piano.queueMode": "follow-up" });
  const pinned = pinnedOpen(page.storage);
  const mode = queueMode(page.storage);
  assert.equal(pinned.get(), false);
  assert.equal(mode.get(), "follow-up");

  pinned.set(true);
  mode.set("steering");
  assert.equal(page.items.get("piano.pinnedOpen"), "true");
  assert.equal(page.items.get("piano.queueMode"), "steering");
});

test("garbage or a missing value decodes to the fallback", () => {
  for (const raw of ["{not json", "", "[]"]) {
    const page = browser({ "piano.pinnedOpen": raw, "piano.queueMode": raw });
    assert.equal(pinnedOpen(page.storage).get(), true, `pinned from ${JSON.stringify(raw)}`);
    assert.equal(queueMode(page.storage).get(), "steering", `mode from ${JSON.stringify(raw)}`);
  }
  assert.equal(pinnedOpen(browser().storage).get(), true);
});

test("a change in another tab reaches subscribers", () => {
  const page = browser();
  const mode = queueMode(page.storage);
  const seen: string[] = [];
  mode.subscribe(() => seen.push(mode.get()));

  page.otherTab.write("piano.queueMode", "follow-up");
  page.otherTab.write("piano.unrelated", "x");
  assert.deepEqual(seen, ["follow-up"]);
  assert.equal(mode.get(), "follow-up");
});

test("a change in another tab is not missed while nothing is subscribed", () => {
  const page = browser();
  const mode = queueMode(page.storage);
  const stop = mode.subscribe(() => {});
  stop();
  page.otherTab.write("piano.queueMode", "follow-up");
  assert.equal(mode.get(), "follow-up");
});

test("another tab clearing storage resets the value to its fallback", () => {
  const page = browser({ "piano.pinnedOpen": "false" });
  const pinned = pinnedOpen(page.storage);
  let notified = 0;
  pinned.subscribe(() => notified++);
  assert.equal(pinned.get(), false);

  page.otherTab.clear();
  assert.equal(pinned.get(), true);
  assert.equal(notified, 1);
});

test("setting the current value neither writes nor notifies", () => {
  const page = browser({ "piano.queueMode": "follow-up" });
  const mode = queueMode(page.storage);
  let notified = 0;
  mode.subscribe(() => notified++);

  mode.set("follow-up");
  assert.equal(page.writes.length, 0);
  assert.equal(notified, 0);

  mode.set("steering");
  mode.set("steering");
  assert.deepEqual(page.writes, [["piano.queueMode", "steering"]]);
  assert.equal(notified, 1);
});

test("an equal value under a new identity is the same preference", () => {
  const page = browser();
  const view = createPreference<{ groupBy: string }>({
    key: "piano.sidebarView",
    decode: () => ({ groupBy: "date" }),
    storage: page.storage,
  });
  const before = view.get();
  view.set({ groupBy: "date" });
  assert.equal(view.get(), before, "the snapshot stays stable, so React does not re-render");
  assert.equal(page.writes.length, 0);
});

test("unavailable storage reads the fallback and keeps a set value for the page", () => {
  const page = browser({ "piano.queueMode": "follow-up" }, { available: false });
  const mode = queueMode(page.storage);
  let notified = 0;
  mode.subscribe(() => notified++);
  assert.equal(mode.get(), "steering");

  mode.set("follow-up");
  assert.equal(mode.get(), "follow-up");
  assert.equal(notified, 1);
  assert.equal(page.writes.length, 0);
});
