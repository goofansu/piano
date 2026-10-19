import assert from "node:assert/strict";
import { test } from "node:test";
import type { NotificationSettings } from "../shared/notifications.ts";
import { type IntegrationsInput, integrationsView } from "../web/src/lib/integrationsView.ts";

const settings = (patch: Partial<NotificationSettings> = {}): NotificationSettings => ({
  integrations: ["slack-hook"],
  selected: null,
  ...patch,
});
const view = (input: Partial<IntegrationsInput> = {}) =>
  integrationsView({ settings: settings(), loadFailed: false, busy: false, ...input });
const ready = (input: Partial<IntegrationsInput> = {}) => {
  const result = view(input);
  assert.notEqual(result.status, "loading");
  return result as Exclude<typeof result, { status: "loading" }>;
};

test("the section loads until the first read settles", () => {
  assert.deepEqual(view({ settings: undefined }), { status: "loading" });
  assert.equal(view({ settings: undefined, loadFailed: true }).status, "unavailable");
});

test("unavailable discovery keeps a saved webhook checked without claiming it is on", () => {
  for (const input of [
    { settings: settings({ integrations: null, selected: "slack-hook" }) },
    // A failed re-read keeps the last value but cannot vouch for its catalog.
    { settings: settings({ selected: "slack-hook" }), loadFailed: true },
  ]) {
    const v = ready(input);
    assert.equal(v.status, "unavailable");
    assert.equal(v.checked, "slack-hook");
    assert.deepEqual(v.options, [{ name: "slack-hook", notAttached: false, disabled: true }]);
    assert.equal(v.on, false);
    assert.equal(v.noWebhooks, false);
    assert.equal(v.refresh, false);
    assert.equal(v.offDisabled, false);
  }
});

test("unavailable discovery with nothing saved offers only Off and claims no empty catalog", () => {
  const v = ready({ settings: settings({ integrations: null }) });
  assert.equal(v.status, "unavailable");
  assert.equal(v.checked, null);
  assert.deepEqual(v.options, []);
  assert.equal(v.on, false);
  assert.equal(v.noWebhooks, false);
});

test("a saved webhook no longer attached stays checked, unpickable and marked", () => {
  const v = ready({ settings: settings({ integrations: ["other"], selected: "gone" }) });
  assert.equal(v.status, "ready");
  assert.equal(v.checked, "gone");
  assert.deepEqual(v.options, [
    { name: "gone", notAttached: true, disabled: true },
    { name: "other", notAttached: false, disabled: false },
  ]);
  assert.equal(v.on, false);
  assert.equal(v.noWebhooks, false);
  assert.equal(v.refresh, true);
});

test("an empty catalog says so and offers Refresh", () => {
  const v = ready({ settings: settings({ integrations: [] }) });
  assert.equal(v.status, "ready");
  assert.deepEqual(v.options, []);
  assert.equal(v.noWebhooks, true);
  assert.equal(v.refresh, true);
  assert.equal(v.on, false);
});

test("an attached saved webhook is on and testable until a change or missing URL blocks it", () => {
  const on = ready({ settings: settings({ selected: "slack-hook" }) });
  assert.equal(on.on, true);
  assert.equal(on.testDisabled, false);
  assert.equal(on.refresh, false);
  const noUrl = ready({ settings: settings({ selected: "slack-hook", problem: "Set the URL." }) });
  assert.equal(noUrl.testDisabled, true);
  assert.equal(noUrl.options[0]?.disabled, true);
  assert.equal(noUrl.offDisabled, false);
  const busy = ready({ settings: settings({ selected: "slack-hook" }), busy: true });
  assert.equal(busy.testDisabled, true);
  assert.equal(busy.offDisabled, true);
});
