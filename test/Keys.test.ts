import assert from "node:assert/strict";
import { test } from "node:test";
import { isImeKey } from "../web/src/lib/keys.ts";

const key = (isComposing: boolean, keyCode: number) => ({ isComposing, keyCode });

test("a key the IME is still processing is not a command key", () => {
  assert.equal(isImeKey(key(true, 13)), true);
  // Safari's Enter that accepts a candidate arrives after compositionend: isComposing false, 229.
  assert.equal(isImeKey(key(false, 229)), true);
  assert.equal(isImeKey(key(false, 13)), false);
});

test("reads a React event through its native event", () => {
  assert.equal(isImeKey({ nativeEvent: key(false, 229) }), true);
  assert.equal(isImeKey({ nativeEvent: key(true, 13) }), true);
  assert.equal(isImeKey({ nativeEvent: key(false, 13) }), false);
});
