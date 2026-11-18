import assert from "node:assert/strict";
import { test } from "node:test";
import { isImeKey, machineNavigationIndex, sessionNavigationKey } from "../web/src/lib/keys.ts";

const key = (isComposing: boolean, keyCode: number) => ({ isComposing, keyCode });

test("a key the IME is still processing is not a command key", () => {
  assert.equal(isImeKey(key(true, 13)), true);
  assert.equal(isImeKey(key(false, 229)), true);
  assert.equal(isImeKey(key(false, 13)), false);
});

test("sidebar navigation takes only Alt+Up/Down, including repeat, never IME or consumed keys", () => {
  const arrow = (patch: Partial<KeyboardEvent> = {}) =>
    ({
      key: "ArrowDown",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      isComposing: false,
      keyCode: 40,
      defaultPrevented: false,
      ...patch,
    }) as KeyboardEvent;
  assert.equal(sessionNavigationKey(arrow()), 1);
  assert.equal(sessionNavigationKey(arrow({ key: "ArrowUp" })), -1);
  assert.equal(sessionNavigationKey(arrow({ repeat: true })), 1);
  for (const patch of [
    { altKey: false },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { key: "ArrowLeft" },
    { isComposing: true },
    { keyCode: 229 },
    { defaultPrevented: true },
  ])
    assert.equal(sessionNavigationKey(arrow(patch)), undefined, JSON.stringify(patch));
});

test("a modifier pressed on its own, on the way to the next chord, is not another action", () => {
  const press = (key: string, patch: Partial<KeyboardEvent> = {}) =>
    ({ key, altKey: key === "Alt", isComposing: false, keyCode: 0, ...patch }) as KeyboardEvent;
  for (const key of ["Alt", "AltGraph", "Control", "Meta", "Shift"])
    assert.equal(sessionNavigationKey(press(key)), "modifier", key);
  assert.equal(sessionNavigationKey(press("a", { altKey: true })), undefined);
  assert.equal(sessionNavigationKey(press("Escape")), undefined);
  assert.equal(sessionNavigationKey(press("Alt", { isComposing: true })), undefined);
});

const machineKey = (patch: Partial<KeyboardEvent> = {}) =>
  ({
    key: "2",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 50,
    defaultPrevented: false,
    ...patch,
  }) as KeyboardEvent;
const macPwa = { platform: "MacIntel", standalone: true };

test("machine numbers follow picker order, with 9 meaning ninth, not last", () => {
  assert.equal(machineNavigationIndex(machineKey({ key: "1" }), 10, macPwa), 0);
  assert.equal(machineNavigationIndex(machineKey(), 10, macPwa), 1);
  assert.equal(machineNavigationIndex(machineKey({ key: "9" }), 10, macPwa), 8);
  assert.equal(machineNavigationIndex(machineKey({ key: "9" }), 3, macPwa), undefined);
  assert.equal(machineNavigationIndex(machineKey(), 0, macPwa), undefined);
});

test("machine shortcuts are macOS standalone only, leaving browser tab chords alone", () => {
  for (const environment of [
    { ...macPwa, standalone: false },
    { ...macPwa, platform: "Linux x86_64" },
    { ...macPwa, platform: "Win32" },
    { ...macPwa, platform: "iPhone" },
    { ...macPwa, platform: "iPad" },
  ])
    assert.equal(machineNavigationIndex(machineKey(), 3, environment), undefined);
});

test("machine switching takes only unconsumed, nonrepeating Cmd+1..9, never IME", () => {
  for (const patch of [
    { metaKey: false },
    { metaKey: false, ctrlKey: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { defaultPrevented: true },
    { key: "0" },
    { key: "10" },
    { key: "!" },
  ])
    assert.equal(
      machineNavigationIndex(machineKey(patch), 10, macPwa),
      undefined,
      JSON.stringify(patch),
    );
});

test("reads a React event through its native event", () => {
  assert.equal(isImeKey({ nativeEvent: key(false, 229) }), true);
  assert.equal(isImeKey({ nativeEvent: key(true, 13) }), true);
  assert.equal(isImeKey({ nativeEvent: key(false, 13) }), false);
});
