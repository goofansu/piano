import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, reduce, sessionKey } from "../web/src/store.ts";

test("a late queue restore appends to its original session draft without changing the current view", () => {
  const original = { cwd: "/scratch/a", sessionId: "a" };
  const current = { cwd: "/scratch/b", sessionId: "b" };
  let state = reduce(initialState, { type: "draft_changed", key: sessionKey(original), text: "existing edit" });
  state = reduce(state, { type: "draft_changed", key: sessionKey(current), text: "other draft" });
  state = reduce(state, { type: "selecting", ...current });
  state = reduce(state, { type: "server", message: {
    _tag: "action_result", ...original,
    result: { _tag: "queue_restored", messages: [
      { kind: "steering", text: "change direction" },
      { kind: "follow-up", text: "later\nwith detail" },
      { kind: "follow-up", text: "later\nwith detail" },
    ] },
  } });
  assert.equal(state.drafts[sessionKey(original)], "existing edit\n\nchange direction\n\nlater\nwith detail\n\nlater\nwith detail");
  assert.equal(state.drafts[sessionKey(current)], "other draft");
  assert.deepEqual(state.selecting, current);
  assert.equal(state.view.kind, "session");
});

test("a late submission outcome cannot replace the explanation for newer input", () => {
  let state = reduce(initialState, { type: "server", message: {
    _tag: "selected", cwd: "/scratch/a", sessionId: "a", hosted: true,
    snapshot: { state: { sessionId: "a", isStreaming: true, submission: { id: 2, outcome: "queued" } }, messages: [], dialogs: [] },
  } });
  state = reduce(state, { type: "server", message: { _tag: "session", event: {
    _tag: "submission", submission: { id: 1, outcome: "handled" },
  } } });
  assert.equal(state.session?.state.submission?.outcome, "queued");
  assert.equal(state.session?.state.isStreaming, true, "handling input never settles current activity");
  assert.deepEqual(state.session?.messages, [], "handling input never invents a user message");
});

test("an empty native queue result does not erase editor text", () => {
  const identity = { cwd: "/scratch/a", sessionId: "a" };
  const state = reduce(initialState, { type: "draft_changed", key: sessionKey(identity), text: "keep this" });
  const restored = reduce(state, { type: "server", message: {
    _tag: "action_result", ...identity, result: { _tag: "queue_restored", messages: [] },
  } });
  assert.equal(restored.drafts[sessionKey(identity)], "keep this");
});
