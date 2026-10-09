import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage } from "../shared/wire.ts";
import { initialState, reduce, sessionDelivery, sessionKey } from "../web/src/store.ts";

const selection = (sessionId: string, selectionId: string, sequence = 10, generation = "child"): Extract<ServerMessage, { _tag: "selected" }> => ({
  _tag: "selected", cwd: "/scratch", sessionId, selectionId, hosted: true,
  cursor: { cwd: "/scratch", sessionId, generation, sequence },
  snapshot: { state: { sessionId, isStreaming: true }, messages: [], dialogs: [], pending: { id: "partial", role: "assistant", text: "current partial" } },
});

test("INV-05: superseded selection, duplicate, cross-session and gapped frames never overwrite the current view", () => {
  let state = reduce({ ...initialState, connected: true }, { type: "selecting", cwd: "/scratch", sessionId: "a", selectionId: "a1" });
  state = reduce(state, { type: "selecting", cwd: "/scratch", sessionId: "b", selectionId: "b1" });
  const deliver = (message: ServerMessage) => state = reduce(state, { type: "server", message });
  deliver(selection("a", "a1"));
  assert.equal(Boolean(state.session), false, "late selection A cannot replace pending B");
  deliver(selection("b", "b1"));
  const baseline = state;
  deliver(selection("a", "a1")); assert.equal(state, baseline);
  const message: Extract<ServerMessage, { _tag: "session" }> = {
    _tag: "session", selectionId: "b1", cursor: { cwd: "/scratch", sessionId: "b", generation: "child", sequence: 11 },
    event: { _tag: "message_end", message: { id: "reply", role: "assistant", text: "final" } },
  };
  deliver({ ...message, cursor: { ...message.cursor, sessionId: "a" } }); assert.equal(state, baseline);
  deliver(message); const final = state;
  deliver(message); assert.equal(state, final, "duplicate final message cannot be appended twice");
  deliver(selection("b", "b1")); assert.equal(state, final, "old snapshot cannot roll back newer events");
  assert.deepEqual(state.session?.messages.map(m => m.text), ["final"]);
  deliver({ ...message, cursor: { ...message.cursor, sequence: 13 }, event: { _tag: "notice", level: "error", message: "gap" } });
  assert.equal(state.resync, true);
  assert.equal(sessionDelivery(state, message), "ignore", "no stale notifications while resynchronizing");
  const retained = state.session;
  state = reduce(state, { type: "selecting", cwd: "/scratch", sessionId: "b", selectionId: "b2" });
  assert.equal(state.session, retained, "resynchronizing the same session keeps its visible projection");
  const awaiting = state;
  deliver(selection("b", "b1", 50)); assert.equal(state, awaiting, "even a newer sequence cannot revive an old attachment");
  deliver(selection("b", "b2", 20));
  assert.equal(state.session?.pending?.text, "current partial"); assert.equal(state.resync, false);
  deliver({ ...message, selectionId: "b2", cursor: { ...message.cursor, generation: "restarted", sequence: 1 } });
  assert.equal(state.resync, true, "a new generation requires a snapshot, not a delta");
  state = reduce(state, { type: "selecting", cwd: "/scratch", sessionId: "b", selectionId: "b3" });
  deliver(selection("b", "b3", 0, "restarted"));
  assert.equal(state.session?.cursor?.generation, "restarted"); assert.equal(state.resync, false);
  state = reduce(state, { type: "new" });
  const newPage = state;
  deliver(selection("b", "b3", 100, "restarted")); assert.equal(state, newPage, "returning to New invalidates selection responses too");
});

test("INV-02/05: reconnect retains the view and draft until a fresh attachment snapshot, even at the same cursor", () => {
  const identity = { cwd: "/scratch", sessionId: "a" };
  let state = reduce({ ...initialState, connected: true }, { type: "selecting", ...identity, selectionId: "before" });
  state = reduce(state, { type: "server", message: selection("a", "before") });
  state = reduce(state, { type: "draft_changed", key: sessionKey(identity), text: "unsent draft" });
  const visible = state.session;
  state = reduce(state, { type: "connected", connected: false });
  assert.equal(state.session, visible);
  const disconnected = state;
  state = reduce(state, { type: "server", message: selection("a", "before", 50) });
  assert.equal(state, disconnected, "the disconnected attachment cannot update the retained view");
  state = reduce(state, { type: "connected", connected: true });
  assert.equal(state.selectionId, null, "a new connection is not yet an attachment");
  state = reduce(state, { type: "selecting", ...identity, selectionId: "after" });
  assert.equal(state.session, visible);
  assert.equal(state.drafts[sessionKey(identity)], "unsent draft");
  const delta: Extract<ServerMessage, { _tag: "session" }> = {
    _tag: "session", selectionId: "after", cursor: { ...identity, generation: "child", sequence: 11 },
    event: { _tag: "message_end", message: { id: "too-early", role: "assistant", text: "not synchronized" } },
  };
  assert.equal(sessionDelivery(state, { ...delta, selectionId: "before" }), "ignore");
  assert.equal(sessionDelivery(state, delta), "ignore", "wait for the new snapshot before accepting deltas or notices");
  const awaiting = state;
  state = reduce(state, { type: "server", message: delta });
  assert.equal(state, awaiting);
  const fresh = selection("a", "after");
  state = reduce(state, { type: "server", message: { ...fresh, snapshot: { ...fresh.snapshot, pending: { id: "partial", role: "assistant", text: "refreshed projection" } } } });
  assert.equal(state.selecting, null, "an unchanged cursor still completes reattachment");
  assert.equal(state.session?.pending?.text, "refreshed projection");
  assert.equal(state.drafts[sessionKey(identity)], "unsent draft");
  assert.equal(sessionDelivery(state, delta), "apply");
  state = reduce(state, { type: "selecting", cwd: "/scratch", sessionId: "b", selectionId: "other" });
  assert.equal(state.session, null, "actual navigation must not show the previous session as the new one");
});

test("a late queue restore appends to its original session draft without changing the current view", () => {
  const original = { cwd: "/scratch/a", sessionId: "a" };
  const current = { cwd: "/scratch/b", sessionId: "b" };
  let state = reduce(initialState, { type: "draft_changed", key: sessionKey(original), text: "existing edit" });
  state = reduce(state, { type: "draft_changed", key: sessionKey(current), text: "other draft" });
  state = reduce(state, { type: "selecting", selectionId: "select-b", ...current });
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
  const cursor = { cwd: "/scratch/a", sessionId: "a", generation: "child", sequence: 5 };
  let state = reduce({ ...initialState, connected: true, selectionId: "select-a" }, { type: "server", message: {
    _tag: "selected", selectionId: "select-a", cursor, cwd: "/scratch/a", sessionId: "a", hosted: true,
    snapshot: { state: { sessionId: "a", isStreaming: true, submission: { id: 2, outcome: "queued" } }, messages: [], dialogs: [] },
  } });
  state = reduce(state, { type: "server", message: { _tag: "session", selectionId: "select-a", cursor: { ...cursor, sequence: 6 }, event: {
    _tag: "submission", submission: { id: 1, outcome: "handled" },
  } } });
  assert.equal(state.session?.state.submission?.outcome, "queued");
  assert.equal(state.session?.state.isStreaming, true, "handling input never settles current activity");
  assert.deepEqual(state.session?.messages, [], "handling input never invents a user message");
});

test("a disappearing host is not a completed turn; an actual idle transition is", () => {
  const host = { cwd: "/scratch/a", sessionId: "a", streaming: true };
  const running = reduce(initialState, { type: "server", message: { _tag: "hosts", hosts: [host] } });
  const exited = reduce(running, { type: "server", message: { _tag: "hosts", hosts: [] } });
  assert.deepEqual(exited.done, []);
  const settled = reduce(running, { type: "server", message: { _tag: "hosts", hosts: [{ ...host, streaming: false }] } });
  assert.deepEqual(settled.done, [sessionKey(host)]);
});

test("an empty native queue result does not erase editor text", () => {
  const identity = { cwd: "/scratch/a", sessionId: "a" };
  const state = reduce(initialState, { type: "draft_changed", key: sessionKey(identity), text: "keep this" });
  const restored = reduce(state, { type: "server", message: {
    _tag: "action_result", ...identity, result: { _tag: "queue_restored", messages: [] },
  } });
  assert.equal(restored.drafts[sessionKey(identity)], "keep this");
});

test("a session created with a first message is starting until Pi reports its submission or the request fails", () => {
  const created = (selectionId: string): Extract<ServerMessage, { _tag: "selected" }> => ({
    _tag: "selected", cwd: "/scratch", sessionId: "new", selectionId, hosted: true,
    cursor: { cwd: "/scratch", sessionId: "new", generation: "child", sequence: 0 },
    snapshot: { state: { sessionId: "new", isStreaming: false }, messages: [], dialogs: [] },
  });
  const open = (selectionId: string, firstMessage?: boolean) => reduce(
    reduce({ ...initialState, connected: true }, { type: "selecting", cwd: "/scratch", sessionId: null, selectionId, firstMessage }),
    { type: "server", message: created(selectionId) });

  assert.equal(open("empty").session?.starting, false, "a session created without a message is settled");
  let state = open("sent", true);
  assert.equal(state.session?.starting, true);
  state = reduce(state, { type: "server", message: {
    _tag: "session", selectionId: "sent", cursor: { cwd: "/scratch", sessionId: "new", generation: "child", sequence: 1 },
    event: { _tag: "submission", submission: { id: 1, outcome: "rejected" } },
  } });
  assert.equal(state.session?.starting, false, "the submission outcome now describes the message");
  state = reduce(open("failed", true), { type: "server", message: { _tag: "error", message: "prompt failed" } });
  assert.equal(state.session?.starting, false, "a failed request leaves nothing on its way");
});
