import assert from "node:assert/strict";
import { test } from "node:test";
import { isImeKey, sessionNavigationDirection } from "../web/src/lib/keys.ts";

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
  assert.equal(sessionNavigationDirection(arrow()), 1);
  assert.equal(sessionNavigationDirection(arrow({ key: "ArrowUp" })), -1);
  assert.equal(sessionNavigationDirection(arrow({ repeat: true })), 1);
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
    assert.equal(sessionNavigationDirection(arrow(patch)), undefined, JSON.stringify(patch));
});

test("reads a React event through its native event", () => {
  assert.equal(isImeKey({ nativeEvent: key(false, 229) }), true);
  assert.equal(isImeKey({ nativeEvent: key(true, 13) }), true);
  assert.equal(isImeKey({ nativeEvent: key(false, 13) }), false);
});
