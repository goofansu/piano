import assert from "node:assert/strict";
import { test } from "node:test";
import { middleEllipsis } from "../web/src/lib/middleEllipsis.ts";

const monospace = (text: string) => [...text].length * 8;

test("Environment names keep both ends instead of reserving everything after the slash", () => {
  assert.equal(
    middleEllipsis("fix/environment-name-truncation", 160, monospace),
    "fix/envir…truncation",
  );
  assert.equal(middleEllipsis("goofansu/piano", 80, monospace), "goof…piano");
  assert.equal(middleEllipsis("goofansu/piano", 112, monospace), "goofansu/piano");
  assert.equal(middleEllipsis("main", 160, monospace), "main");
});

test("available width and measured glyphs, not a character limit, determine the fit", () => {
  const proportional = (text: string) =>
    [...text].reduce((width, char) => width + (char === "W" ? 12 : 4), 0);
  assert.equal(middleEllipsis("WWiiiiWW", 28, proportional), "W…W");
  assert.equal(middleEllipsis("WWiiiiWW", 40, proportional), "W…WW");
  assert.equal(middleEllipsis("WWiiiiWW", 64, proportional), "WWiiiiWW");
  assert.equal(middleEllipsis("WWiiiiWW", 28, proportional), "W…W");
});

test("never cut a grapheme or leave a partially clipped prefix in very small slots", () => {
  const graphemes = (text: string) => [...new Intl.Segmenter().segment(text)].length * 8;
  assert.equal(middleEllipsis("e\u0301-long-👩‍💻", 24, graphemes), "e\u0301…👩‍💻");
  assert.equal(middleEllipsis("branch", 16, monospace), "…");
  assert.equal(middleEllipsis("branch", 7, monospace), "");
  assert.equal(middleEllipsis("branch", 0, monospace), "");
});
