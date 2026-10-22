import assert from "node:assert/strict";
import { test } from "node:test";
import type { SlashCommand } from "../shared/wire.ts";
import {
  acceptCompletion,
  commandToken,
  completionRange,
  initialSlashState,
  rankCommands,
  type SlashKey,
  type SlashState,
  type SlashView,
  slashAccept,
  slashActive,
  slashKeyDown,
  slashOpen,
  slashUpdate,
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

test("offers skills and templates, prefix matches on the typed name first, ignoring case", () => {
  const ranked = rankCommands(
    [
      skill("skill:preview"),
      { name: "review", source: "prompt" },
      { name: "skill:reviewer", source: "extension" },
      skill("skill:Review"),
      { name: "prev", source: "prompt" },
      skill("skill:commit"),
    ],
    "REV",
  );
  assert.deepEqual(
    ranked.map((command) => command.name),
    ["review", "skill:Review", "prev", "skill:preview"],
  );
});

test("does not offer a template shadowed by an earlier command of the same name", () => {
  const ranked = rankCommands(
    [
      { name: "handled", source: "extension" },
      { name: "handled", source: "prompt" },
      { name: "review", source: "prompt" },
    ],
    "",
  );
  assert.deepEqual(
    ranked.map((command) => command.name),
    ["review"],
  );
});

test("offers at most fifty suggestions", () => {
  const many = Array.from({ length: 60 }, (_, i) => skill(`skill:s${String(i).padStart(2, "0")}`));
  const ranked = rankCommands(many, "");
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

const view = (value: string, overrides: Partial<SlashView> = {}): SlashView => ({
  value,
  enabled: true,
  readOnly: false,
  context: "ctx",
  ...overrides,
});
/** Focused in `value` with a collapsed caret at its end, or at `caret`. */
const focused = (value: string, caret = value.length): SlashState =>
  slashUpdate(initialSlashState, view(value), { type: "focus", value, selection: at(caret) });
const press = (key: string, extra: Partial<SlashKey> = {}, caret = 0): SlashKey => ({
  key,
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 0,
  selection: at(caret),
  ...extra,
});

test("opens only while focused, enabled, not composing and in a leading token", () => {
  assert.equal(slashOpen(focused("/re"), view("/re")), true);
  assert.equal(slashOpen(initialSlashState, view("/re")), false);
  assert.equal(slashOpen(focused("/re"), view("/re", { enabled: false })), false);
  assert.equal(slashOpen(focused("say /re"), view("say /re")), false);
  const composing = slashUpdate(focused("/re"), view("/re"), { type: "composition-start" });
  assert.equal(slashOpen(composing, view("/re")), false);
});

test("an IME keystroke is neither handled nor forwarded", () => {
  const state = focused("/re");
  for (const key of [
    press("Enter", { isComposing: true }),
    press("Enter", { keyCode: 229 }),
    press("Escape", { keyCode: 229 }),
  ])
    assert.deepEqual(slashKeyDown(state, view("/re"), key, 3).effect, { type: "ignore" });
  const composing = slashUpdate(state, view("/re"), { type: "composition-start" });
  assert.deepEqual(slashKeyDown(composing, view("/re"), press("Tab"), 3).effect, {
    type: "ignore",
  });
});

test("arrows wrap around the list and a new caret position starts at the top", () => {
  let state = focused("/re");
  const move = (key: string) => {
    const result = slashKeyDown(state, view("/re"), press(key), 3);
    assert.deepEqual(result.effect, { type: "move" });
    state = result.state;
    return slashActive(state, view("/re"), 3);
  };
  assert.equal(move("ArrowUp"), 2);
  assert.equal(move("ArrowDown"), 0);
  assert.equal(move("ArrowDown"), 1);
  // Typing elsewhere and coming back does not restore the old highlight.
  state = slashUpdate(state, view("/re"), { type: "select", value: "/r", selection: at(2) });
  state = slashUpdate(state, view("/r"), { type: "select", value: "/re", selection: at(3) });
  assert.equal(slashActive(state, view("/re"), 3), 0);
});

test("modified arrows and keys with nothing listed pass to the composer", () => {
  const state = focused("/re");
  assert.deepEqual(
    slashKeyDown(state, view("/re"), press("ArrowDown", { shiftKey: true }), 3).effect,
    {
      type: "pass",
    },
  );
  assert.deepEqual(slashKeyDown(state, view("/re"), press("Enter"), 0).effect, { type: "pass" });
});

test("Tab or Enter accepts the highlighted command once; holding the key does nothing more", () => {
  const state = focused("/re");
  assert.deepEqual(slashKeyDown(state, view("/re"), press("Tab"), 3).effect, {
    type: "accept",
    index: 0,
  });
  assert.deepEqual(slashKeyDown(state, view("/re"), press("Enter", { repeat: true }), 3).effect, {
    type: "hold",
  });
});

test("Escape closes the list until the text or caret changes or the textarea is refocused", () => {
  const { state, effect } = slashKeyDown(focused("/re"), view("/re"), press("Escape"), 3);
  assert.deepEqual(effect, { type: "close" });
  assert.equal(slashOpen(state, view("/re")), false);
  // Escape again is the composer's.
  assert.deepEqual(slashKeyDown(state, view("/re"), press("Escape"), 3).effect, { type: "pass" });
  const moved = slashUpdate(state, view("/re"), { type: "select", value: "/re", selection: at(2) });
  assert.equal(slashOpen(moved, view("/re")), true);
  assert.equal(slashOpen(state, view("/rev")), true);
  assert.equal(slashOpen(state, view("/re", { context: "other" })), true);
  const refocused = slashUpdate(state, view("/re"), {
    type: "focus",
    value: "/re",
    selection: at(3),
  });
  assert.equal(slashOpen(refocused, view("/re")), true);
});

test("accepting names the command and keeps the list closed at the new caret", () => {
  const state = focused("/re");
  const accepted = slashAccept(state, view("/re"), "skill:review", {
    value: "/re",
    selection: at(3),
  });
  assert.ok(accepted);
  assert.equal(accepted.text, "/skill:review ");
  assert.equal(accepted.caret, 14);
  const after = slashUpdate(accepted.state, view(accepted.text), {
    type: "select",
    value: accepted.text,
    selection: at(14),
  });
  assert.equal(slashOpen(after, view(accepted.text)), false);
  // The textarea moved on since the render that offered the list: nothing is accepted.
  assert.equal(
    slashAccept(state, view("/re"), "skill:review", { value: "/rev", selection: at(4) }),
    null,
  );
  assert.equal(
    slashAccept(state, view("/re"), "skill:review", { value: "/re", selection: at(2) }),
    null,
  );
});

test("Backspace after an accepted command selects the whole token first", () => {
  const text = "/skill:review arg";
  const state = { ...focused(text, 13), accepted: "skill:review" };
  const { state: next, effect } = slashKeyDown(state, view(text), press("Backspace", {}, 13), 0);
  assert.deepEqual(effect, { type: "select-token", from: 0, to: 13 });
  assert.deepEqual(next.selection, { start: 0, end: 13 });
  // A held Backspace keeps the token selected rather than deleting it a character at a time.
  const held = press("Backspace", { repeat: true, selection: { start: 0, end: 13 } });
  assert.equal(slashKeyDown(next, view(text), held, 0).effect.type, "select-token");
  // Once selected, a fresh Backspace deletes it; so does one with a modifier or in a read-only box.
  const fresh = press("Backspace", { selection: { start: 0, end: 13 } });
  assert.deepEqual(slashKeyDown(next, view(text), fresh, 0).effect, { type: "pass" });
  assert.deepEqual(
    slashKeyDown(state, view(text), press("Backspace", { altKey: true }, 13), 0).effect,
    {
      type: "pass",
    },
  );
  assert.deepEqual(
    slashKeyDown(state, view(text, { readOnly: true }), press("Backspace", {}, 13), 0).effect,
    { type: "pass" },
  );
});
