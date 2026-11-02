import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDiff } from "../web/src/lib/lineDiff.ts";

test("a replaced line reads as a removal then an addition, numbered on each side", () => {
  const before = '---\ndescription: "D"\n---\nOld line.\nKept.\n';
  const after = '---\ndescription: "D"\n---\nNew line.\nKept.\nAdded.\n';
  const file = lineDiff("triage file", before, after);
  assert.deepEqual([file.additions, file.deletions], [2, 1]);
  assert.equal(file.hunks.length, 1);
  assert.equal(file.hunks[0].header, "@@ -1,5 +1,6 @@");
  assert.deepEqual(
    file.hunks[0].lines.map(({ kind, text, old, new: next }) => [kind, text, old, next]),
    [
      ["context", "---", 1, 1],
      ["context", 'description: "D"', 2, 2],
      ["context", "---", 3, 3],
      ["del", "Old line.", 4, undefined],
      ["add", "New line.", undefined, 4],
      ["context", "Kept.", 5, 5],
      ["add", "Added.", undefined, 6],
    ],
  );
  assert.deepEqual(lineDiff("same", before, before).hunks, [], "no change, no hunks");
});

test("changes far apart are separate hunks with three lines of context", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const changed = lines.map((line, i) => (i === 1 || i === 17 ? `${line}!` : line));
  const { hunks } = lineDiff("far", `${lines.join("\n")}\n`, `${changed.join("\n")}\n`);
  assert.deepEqual(
    hunks.map((hunk) => hunk.header),
    ["@@ -1,5 +1,5 @@", "@@ -15,6 +15,6 @@"],
  );
});
