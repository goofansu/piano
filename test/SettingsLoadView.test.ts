import assert from "node:assert/strict";
import { test } from "node:test";
import { type SettingsLoadInput, settingsLoadView } from "../web/src/lib/settingsLoadView.ts";

const view = (input: Partial<SettingsLoadInput<string[]>> = {}) =>
  settingsLoadView<string[]>({
    value: undefined,
    error: undefined,
    loading: false,
    isEmpty: (rows) => rows.length === 0,
    ...input,
  });

test("the first read shows the placeholder, then the rows or the empty line", () => {
  assert.deepEqual(view({ loading: true }), { body: "loading", failure: false, retrying: false });
  assert.deepEqual(view({ value: ["a"] }), {
    body: "rows",
    value: ["a"],
    failure: false,
    retrying: false,
  });
  assert.equal(view({ value: [] }).body, "empty");
  // A page that is never empty shows what it read, whatever it holds.
  assert.equal(view({ value: [], isEmpty: undefined }).body, "rows");
});

test("a failed first read shows the failure in place of the placeholder, with no rows", () => {
  const failed = view({ error: "offline" });
  assert.deepEqual(failed, { body: "failure", failure: true, retrying: false });
  assert.equal("value" in failed, false);
});

test("a failed re-read keeps the rows and shows the failure above them", () => {
  assert.deepEqual(view({ value: ["a"], error: "offline" }), {
    body: "rows",
    value: ["a"],
    failure: true,
    retrying: false,
  });
  assert.deepEqual(view({ value: [], error: "offline" }).body, "empty");
  assert.equal(view({ value: [], error: "offline" }).failure, true);
});

test("Retry in flight keeps the failure, turning, rather than returning to the placeholder", () => {
  assert.deepEqual(view({ error: "offline", loading: true }), {
    body: "failure",
    failure: true,
    retrying: true,
  });
  const stale = view({ value: ["a"], error: "offline", loading: true });
  assert.equal(stale.body, "rows");
  assert.equal(stale.failure, true);
  assert.equal(stale.retrying, true);
});
