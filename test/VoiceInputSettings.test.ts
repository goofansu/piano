import assert from "node:assert/strict";
import { test } from "node:test";
import type { VoiceInputSave, VoiceInputState } from "../shared/voiceInput.ts";
import type { ObservationEnvironment } from "../web/src/lib/observation.ts";
import { createVoiceInputSettings } from "../web/src/lib/voiceInputSettings.ts";

/** Timers that never fire and a focus the test gives, so every read here is one the test caused. */
function browser() {
  const focus = new Set<() => void>();
  const environment: ObservationEnvironment = {
    setTimeout: () => undefined,
    clearTimeout: () => {},
    onFocus: (listener) => {
      focus.add(listener);
      return () => focus.delete(listener);
    },
    hidden: () => false,
  };
  return { environment, focus: () => focus.forEach((listener) => listener()) };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Piano's voice input endpoints, answered by the test one request at a time. */
function server() {
  const reads: ((state: VoiceInputState) => void)[] = [];
  const saves: { change: VoiceInputSave; answer: (state: VoiceInputState) => void }[] = [];
  return {
    reads,
    saves,
    load: () => new Promise<VoiceInputState>((resolve) => reads.push(resolve)),
    save: (change: VoiceInputSave) =>
      new Promise<VoiceInputState>((answer) => saves.push({ change, answer })),
  };
}

const off: VoiceInputState = { enabled: false, hasKey: false };
const on: VoiceInputState = { enabled: true, hasKey: true };

test("a save in Settings reaches every reader on the page without reading again", async () => {
  const api = server();
  const settings = createVoiceInputSettings({ ...api, environment: browser().environment });
  // Settings and a composer both read the one shared state.
  let composerSaw: VoiceInputState | undefined;
  settings.subscribe(() => (composerSaw = settings.getState().value));
  settings.start();
  settings.start(); // A second reader starts nothing new.
  assert.equal(api.reads.length, 1);
  api.reads[0]!(off);
  await settle();
  assert.deepEqual(composerSaw, off);

  const saved = settings.save({ enabled: true, key: "sk-test-0123456789" });
  assert.deepEqual(api.saves[0]!.change, { enabled: true, key: "sk-test-0123456789" });
  api.saves[0]!.answer(on);
  assert.deepEqual(await saved, on);
  assert.deepEqual(composerSaw, on, "the composer sees the saved state");
  assert.equal(api.reads.length, 1, "no reload was needed");
});

test("a read that started before a save cannot undo it", async () => {
  const api = server();
  const page = browser();
  const settings = createVoiceInputSettings({ ...api, environment: page.environment });
  settings.start();
  api.reads[0]!(on);
  await settle();
  // Focus starts a read; turning voice input off happens while it is in flight.
  page.focus();
  assert.equal(api.reads.length, 2);
  const saved = settings.save({ enabled: false });
  api.reads[1]!(on);
  api.saves[0]!.answer({ enabled: false, hasKey: true });
  await saved;
  await settle();
  assert.deepEqual(settings.getState().value, { enabled: false, hasKey: true });
});

test("focus reads again, for a change saved in another tab", async () => {
  const api = server();
  const page = browser();
  const settings = createVoiceInputSettings({ ...api, environment: page.environment });
  settings.start();
  api.reads[0]!(off);
  await settle();
  page.focus();
  api.reads[1]!(on);
  await settle();
  assert.deepEqual(settings.getState().value, on);
});

test("a refused save keeps the last state and rejects with the refusal", async () => {
  const api = server();
  const settings = createVoiceInputSettings({
    ...api,
    save: () => Promise.reject(new Error("Add an OpenAI API key to turn on voice input.")),
    environment: browser().environment,
  });
  settings.start();
  api.reads[0]!(off);
  await settle();
  await assert.rejects(settings.save({ enabled: true }), /Add an OpenAI API key/);
  assert.deepEqual(settings.getState().value, off);
});
