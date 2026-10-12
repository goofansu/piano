import assert from "node:assert/strict";
import { test } from "node:test";
import type { SlashCommand } from "../shared/wire.ts";
import {
  acceptCompletion,
  commandToken,
  completionRange,
  rankSkills,
} from "../web/src/lib/slashCompletion.ts";

const at = (caret: number) => ({ start: caret, end: caret });
const skill = (name: string): SlashCommand => ({ name, source: "skill" });

test("completes the leading token while the caret is inside it, querying up to the caret", () => {
  assert.deepEqual(completionRange("/ReV more", at(3)), { from: 0, to: 4, query: "re" });
  assert.deepEqual(completionRange("  /rev", at(6)), { from: 2, to: 6, query: "rev" });
  assert.deepEqual(completionRange("/", at(1)), { from: 0, to: 1, query: "" });
});

test("does not complete before the slash, past the token, a selection, a later token or a path", () => {
  assert.equal(completionRange("/rev", at(0)), null);
  assert.equal(completionRange("/rev arg", at(6)), null);
  assert.equal(completionRange("/rev", { start: 1, end: 3 }), null);
  assert.equal(completionRange("say /rev", at(8)), null);
  assert.equal(completionRange("/a/b", at(2)), null);
});

test("marks the leading token only while it still names the accepted command", () => {
  assert.deepEqual(commandToken(" /skill:review now", "skill:review"), { from: 1, to: 14 });
  assert.equal(commandToken("/skill:reviews", "skill:review"), null);
  assert.equal(commandToken("/skill:review/x", "skill:review"), null);
  assert.equal(commandToken("/skill:review", undefined), null);
});

test("offers skills only, prefix matches before substring matches, ignoring case", () => {
  const ranked = rankSkills(
    [
      skill("skill:preview"),
      { name: "review", source: "prompt" },
      { name: "skill:reviewer", source: "extension" },
      skill("skill:Review"),
      skill("skill:commit"),
    ],
    "REV",
  );
  assert.deepEqual(
    ranked.map((command) => command.name),
    ["skill:Review", "skill:preview"],
  );
});

test("offers at most fifty suggestions", () => {
  const many = Array.from({ length: 60 }, (_, i) => skill(`skill:s${String(i).padStart(2, "0")}`));
  const ranked = rankSkills(many, "");
  assert.equal(ranked.length, 50);
  assert.equal(ranked[0]?.name, "skill:s00");
  assert.equal(ranked[49]?.name, "skill:s49");
});

test("accepting adds one separator and puts the caret after it", () => {
  assert.deepEqual(acceptCompletion("/re", { from: 0, to: 3 }, "skill:review"), {
    text: "/skill:review ",
    caret: 14,
  });
});

test("accepting reuses existing whitespace and keeps the arguments", () => {
  assert.deepEqual(acceptCompletion(" /re  args", { from: 1, to: 4 }, "skill:review"), {
    text: " /skill:review  args",
    caret: 15,
  });
  assert.deepEqual(acceptCompletion("/re\nnext", { from: 0, to: 3 }, "skill:review"), {
    text: "/skill:review\nnext",
    caret: 14,
  });
});
