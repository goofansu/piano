import assert from "node:assert/strict";
import { test } from "node:test";
import { singleArea } from "../web/src/lib/panelLayout.ts";

test("session capacity uses measured width without rounding; zero supplies no mode update", () => {
  for (const [width, expected] of [
    [0, undefined],
    [848, true],
    [848.5, true],
    [849, false],
    [849.5, false],
    [850, false],
  ] as const) {
    assert.equal(singleArea(width), expected, `areas width ${width}`);
  }
});
