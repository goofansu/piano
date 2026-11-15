import assert from "node:assert/strict";
import { test } from "node:test";
import { isImeKey, sessionNavigationKey } from "../web/src/lib/keys.ts";

const key = (isComposing: boolean, keyCode: number) => ({ isComposing, keyCode });

test("a key the IME is still processing is not a command key", () => {
  assert.equal(isImeKey(key(true, 13)), true);
  // Safari's Enter that accepts a candidate arrives after compositionend: isComposing false, 229.
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

test("reads a React event through its native event", () => {
  assert.equal(isImeKey({ nativeEvent: key(false, 229) }), true);
  assert.equal(isImeKey({ nativeEvent: key(true, 13) }), true);
  assert.equal(isImeKey({ nativeEvent: key(false, 13) }), false);
});
