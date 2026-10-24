import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage } from "../shared/wire.ts";
import { initialState, reduce, sessionDelivery, sessionKey } from "../web/src/store.ts";

const selection = (
  sessionId: string,
  selectionId: string,
  sequence = 10,
  generation = "child",
): Extract<ServerMessage, { _tag: "selected" }> => ({
  _tag: "selected",
  cwd: "/scratch",
  sessionId,
  selectionId,
  hosted: true,
  cursor: { cwd: "/scratch", sessionId, generation, sequence },
  snapshot: {
    state: { sessionId, isStreaming: true },
    messages: [],
    dialogs: [],
    pending: { id: "partial", role: "assistant", text: "current partial" },
  },
});

test("INV-05: superseded selection, duplicate, cross-session and gapped frames never overwrite the current view", () => {
  let state = reduce(
    { ...initialState, connected: true },
    { type: "selecting", cwd: "/scratch", sessionId: "a", selectionId: "a1" },
  );
  state = reduce(state, { type: "selecting", cwd: "/scratch", sessionId: "b", selectionId: "b1" });
  const deliver = (message: ServerMessage) => (state = reduce(state, { type: "server", message }));
  deliver(selection("a", "a1"));
  assert.equal(Boolean(state.session), false, "late selection A cannot replace pending B");
  deliver(selection("b", "b1"));
  const baseline = state;
  deliver(selection("a", "a1"));
  assert.equal(state, baseline);
  const message: Extract<ServerMessage, { _tag: "session" }> = {
    _tag: "session",
    selectionId: "b1",
    cursor: { cwd: "/scratch", sessionId: "b", generation: "child", sequence: 11 },
    event: { _tag: "message_end", message: { id: "reply", role: "assistant", text: "final" } },
  };
  deliver({ ...message, cursor: { ...message.cursor, sessionId: "a" } });
  assert.equal(state, baseline);
  deliver(message);
  const final = state;
  deliver(message);
  assert.equal(state, final, "duplicate final message cannot be appended twice");
  deliver(selection("b", "b1"));
  assert.equal(state, final, "old snapshot cannot roll back newer events");
  assert.deepEqual(
    state.session?.messages.map((m) => m.text),
    ["final"],
  );
  deliver({
    ...message,
    cursor: { ...message.cursor, sequence: 13 },
    event: { _tag: "notice", level: "error", message: "gap" },
  });
  assert.equal(state.resync, true);
  assert.equal(
    sessionDelivery(state, message),
    "ignore",
    "no stale notifications while resynchronizing",
  );
  const retained = state.session;
  state = reduce(state, { type: "selecting", cwd: "/scratch", sessionId: "b", selectionId: "b2" });
  assert.equal(
    state.session,
    retained,
    "resynchronizing the same session keeps its visible projection",
  );
  const awaiting = state;
  deliver(selection("b", "b1", 50));
  assert.equal(state, awaiting, "even a newer sequence cannot revive an old attachment");
  deliver(selection("b", "b2", 20));
  assert.equal(state.session?.pending?.text, "current partial");
  assert.equal(state.resync, false);
  deliver({
    ...message,
    selectionId: "b2",
    cursor: { ...message.cursor, generation: "restarted", sequence: 1 },
  });
  assert.equal(state.resync, true, "a new generation requires a snapshot, not a delta");
  state = reduce(state, { type: "selecting", cwd: "/scratch", sessionId: "b", selectionId: "b3" });
  deliver(selection("b", "b3", 0, "restarted"));
  assert.equal(state.session?.cursor?.generation, "restarted");
  assert.equal(state.resync, false);
  state = reduce(state, { type: "open", page: { kind: "new" } });
  const newPage = state;
  deliver(selection("b", "b3", 100, "restarted"));
  assert.equal(state, newPage, "returning to New invalidates selection responses too");
});

test("INV-02/05: reconnect retains the view until a fresh attachment snapshot, even at the same cursor", () => {
  const identity = { cwd: "/scratch", sessionId: "a" };
  let state = reduce(
    { ...initialState, connected: true },
    { type: "selecting", ...identity, selectionId: "before" },
  );
  state = reduce(state, { type: "server", message: selection("a", "before") });
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
  const delta: Extract<ServerMessage, { _tag: "session" }> = {
    _tag: "session",
    selectionId: "after",
    cursor: { ...identity, generation: "child", sequence: 11 },
    event: {
      _tag: "message_end",
      message: { id: "too-early", role: "assistant", text: "not synchronized" },
    },
  };
  assert.equal(sessionDelivery(state, { ...delta, selectionId: "before" }), "ignore");
  assert.equal(
    sessionDelivery(state, delta),
    "ignore",
    "wait for the new snapshot before accepting deltas or notices",
  );
  const awaiting = state;
  state = reduce(state, { type: "server", message: delta });
  assert.equal(state, awaiting);
  const fresh = selection("a", "after");
  state = reduce(state, {
    type: "server",
    message: {
      ...fresh,
      snapshot: {
        ...fresh.snapshot,
        pending: { id: "partial", role: "assistant", text: "refreshed projection" },
      },
    },
  });
  assert.equal(state.selecting, null, "an unchanged cursor still completes reattachment");
  assert.equal(state.session?.pending?.text, "refreshed projection");
  assert.equal(sessionDelivery(state, delta), "apply");
  state = reduce(state, {
    type: "selecting",
    cwd: "/scratch",
    sessionId: "b",
    selectionId: "other",
  });
  assert.equal(
    state.session,
    null,
    "actual navigation must not show the previous session as the new one",
  );
});

test("a disappearing host is not a completed turn; an actual idle transition is", () => {
  const host = { cwd: "/scratch/a", sessionId: "a", streaming: true };
  const running = reduce(initialState, {
    type: "server",
    message: { _tag: "hosts", hosts: [host] },
  });
  const exited = reduce(running, { type: "server", message: { _tag: "hosts", hosts: [] } });
  assert.deepEqual(exited.done, []);
  const settled = reduce(running, {
    type: "server",
    message: { _tag: "hosts", hosts: [{ ...host, streaming: false }] },
  });
  assert.deepEqual(settled.done, [sessionKey(host)]);
});

test("INV-01/03: first input survives selection and submission until authoritative user history, including expanded commands", () => {
  const created = (selectionId: string): Extract<ServerMessage, { _tag: "selected" }> => ({
    _tag: "selected",
    cwd: "/scratch",
    sessionId: "new",
    selectionId,
    hosted: true,
    cursor: { cwd: "/scratch", sessionId: "new", generation: "child", sequence: 0 },
    snapshot: { state: { sessionId: "new", isStreaming: false }, messages: [], dialogs: [] },
  });
  const firstMessage = {
    text: "/skill:review original",
    attachments: [{ kind: "image" as const, url: "data:image/png;base64,aW1hZ2U=" }],
  };
  let state = reduce(
    { ...initialState, connected: true },
    { type: "selecting", cwd: "/scratch", sessionId: null, selectionId: "sent", firstMessage },
  );
  assert.equal(state.session, null, "no invented session or history before Pi starts");
  assert.deepEqual(state.pendingCreate, {
    selectionId: "sent",
    cwd: "/scratch",
    ...firstMessage,
    outcome: "starting",
  });
  state = reduce(state, { type: "server", message: created("sent") });
  assert.equal(state.pendingCreate?.outcome, "starting");
  assert.deepEqual(state.session?.messages, []);
  state = reduce(state, {
    type: "server",
    message: {
      _tag: "session",
      selectionId: "sent",
      cursor: { cwd: "/scratch", sessionId: "new", generation: "child", sequence: 1 },
      event: { _tag: "submission", submission: { id: 1, outcome: "started" } },
    },
  });
  assert.equal(state.pendingCreate?.outcome, "submitted");
  assert.equal(state.pendingCreate?.text, firstMessage.text);
  state = reduce(state, {
    type: "server",
    message: {
      _tag: "session",
      selectionId: "sent",
      cursor: { cwd: "/scratch", sessionId: "new", generation: "child", sequence: 2 },
      event: {
        _tag: "message_end",
        message: { id: "pi-user", role: "user", text: "expanded skill body" },
      },
    },
  });
  assert.equal(state.pendingCreate, null);
  assert.deepEqual(
    state.session?.messages.map((m) => m.text),
    ["expanded skill body"],
  );
});

const beginCreate = () =>
  reduce(
    { ...initialState, connected: true },
    {
      type: "selecting",
      cwd: "/scratch",
      sessionId: null,
      selectionId: "create",
      firstMessage: {
        text: "original input",
        attachments: [{ kind: "image", url: "data:image/png;base64,aW1hZ2U=" }],
      },
    },
  );
const emptyCreated = (): Extract<ServerMessage, { _tag: "selected" }> => ({
  ...selection("new", "create", 0),
  snapshot: { state: { sessionId: "new", isStreaming: false }, messages: [], dialogs: [] },
});

test("INV-03: handled, rejected and uncertain input retain the original without inventing history or waiting for a run", () => {
  for (const outcome of ["handled", "rejected", "uncertain"] as const) {
    const selected = emptyCreated();
    let state = reduce(beginCreate(), { type: "server", message: selected });
    state = reduce(state, {
      type: "server",
      message: {
        _tag: "session",
        selectionId: "create",
        cursor: { ...selected.cursor!, sequence: 1 },
        event: { _tag: "submission", submission: { id: 1, outcome, detail: "Pi outcome" } },
      },
    });
    assert.equal(state.pendingCreate?.outcome, outcome);
    assert.equal(state.pendingCreate?.text, "original input");
    assert.equal(state.pendingCreate?.attachments?.length, 1);
    assert.deepEqual(state.session?.messages, []);
    assert.equal(state.selecting, null);
  }
});

test("INV-03: a newer submission supersedes the first input receipt without relabelling its text", () => {
  for (const outcome of ["handled", "rejected"] as const) {
    const selected = emptyCreated();
    let state = reduce(beginCreate(), {
      type: "server",
      message: {
        ...selected,
        snapshot: {
          ...selected.snapshot,
          state: { ...selected.snapshot.state, submission: { id: 1, outcome: "submitting" } },
        },
      },
    });
    const deliver = (
      sequence: number,
      event: Extract<ServerMessage, { _tag: "session" }>["event"],
    ) => {
      state = reduce(state, {
        type: "server",
        message: {
          _tag: "session",
          selectionId: "create",
          cursor: { ...selected.cursor!, sequence },
          event,
        },
      });
    };
    deliver(1, { _tag: "submission", submission: { id: 1, outcome } });
    assert.equal(state.pendingCreate?.text, "original input");
    assert.equal(state.pendingCreate?.outcome, outcome, "same submission retains its receipt");
    const submission = { id: 2, outcome: "submitting" as const };
    deliver(
      2,
      outcome === "handled"
        ? { _tag: "submission", submission }
        : {
            _tag: "snapshot",
            snapshot: { ...selected.snapshot, state: { ...selected.snapshot.state, submission } },
          },
    );
    assert.equal(state.pendingCreate, null, "new input must remove the old receipt immediately");
    assert.equal(state.session?.state.submission?.outcome, "submitting");
    deliver(3, {
      _tag: "submission",
      submission: { id: 2, outcome: "rejected", detail: "second input rejected" },
    });
    assert.equal(state.pendingCreate, null, "later outcomes cannot relabel the first input");
    assert.deepEqual(state.session?.messages, [], "receipts never enter authoritative history");
    assert.equal(state.session?.state.submission?.detail, "second input rejected");
  }
});

test("INV-02/05: startup failure and disconnect retain recoverable input without a null-session reconnect or stale navigation", () => {
  let state = beginCreate();
  const initial = state;
  for (const selectionId of [undefined, "older"]) {
    state = reduce(state, {
      type: "server",
      message: { _tag: "error", selectionId, message: "unrelated failure" },
    });
    assert.equal(state, initial);
  }
  state = reduce(state, {
    type: "server",
    message: { _tag: "error", selectionId: "create", message: "Pi startup failed" },
  });
  assert.equal(state.selecting, null);
  assert.equal(state.session, null);
  assert.equal(state.pendingCreate?.outcome, "uncertain");
  assert.equal(state.pendingCreate?.detail, "Pi startup failed");
  assert.equal(state.pendingCreate?.text, "original input");

  state = reduce(beginCreate(), { type: "connected", connected: false });
  assert.equal(state.pendingCreate?.outcome, "uncertain");
  assert.equal(state.selecting, null, "unknown identity must not reconnect by selecting null");
  assert.equal(state.session, null);
  state = reduce(state, { type: "connected", connected: true });
  assert.equal(state.pendingCreate?.text, "original input");
  const reconnected = state;
  state = reduce(state, { type: "server", message: emptyCreated() });
  assert.equal(state, reconnected, "late old-socket snapshot is ignored");

  state = reduce(beginCreate(), {
    type: "selecting",
    cwd: "/elsewhere",
    sessionId: "other",
    selectionId: "navigate",
  });
  const navigated = state;
  state = reduce(state, { type: "server", message: emptyCreated() });
  state = reduce(state, {
    type: "server",
    message: { _tag: "error", selectionId: "create", message: "late failure" },
  });
  assert.equal(state, navigated);
  assert.equal(state.pendingCreate, null);
});

test("INV-01/05: reconnect and snapshot reconciliation retain local input only until Pi supplies the first user message", () => {
  let state = reduce(beginCreate(), { type: "server", message: emptyCreated() });
  state = reduce(state, { type: "connected", connected: false });
  state = reduce(state, { type: "connected", connected: true });
  state = reduce(state, {
    type: "selecting",
    cwd: "/scratch",
    sessionId: "new",
    selectionId: "reattach",
  });
  assert.equal(state.pendingCreate?.outcome, "uncertain");
  const snapshot = { ...emptyCreated(), selectionId: "reattach" };
  state = reduce(state, { type: "server", message: snapshot });
  assert.equal(state.pendingCreate?.text, "original input");
  state = reduce(state, {
    type: "server",
    message: {
      _tag: "session",
      selectionId: "reattach",
      cursor: { ...snapshot.cursor!, sequence: 1 },
      event: {
        _tag: "snapshot",
        snapshot: {
          ...snapshot.snapshot,
          messages: [{ id: "pi-user", role: "user", text: "original input" }],
        },
      },
    },
  });
  assert.equal(state.pendingCreate, null);
  assert.equal(state.session?.messages.length, 1);

  const selected = emptyCreated();
  state = reduce(beginCreate(), {
    type: "server",
    message: {
      ...selected,
      snapshot: {
        ...selected.snapshot,
        messages: [{ id: "pi-user", role: "user", text: "expanded" }],
      },
    },
  });
  assert.equal(
    state.pendingCreate,
    null,
    "first selected snapshot can already include the user message",
  );
});

test("INV-03: disconnect or child exit cannot revoke a confirmed first-input outcome", () => {
  for (const outcome of ["started", "queued", "handled", "rejected"] as const) {
    const selected = emptyCreated();
    let state = reduce(beginCreate(), { type: "server", message: selected });
    state = reduce(state, {
      type: "server",
      message: {
        _tag: "session",
        selectionId: "create",
        cursor: { ...selected.cursor!, sequence: 1 },
        event: { _tag: "submission", submission: { id: 1, outcome } },
      },
    });
    const expected = outcome === "started" || outcome === "queued" ? "submitted" : outcome;
    state = reduce(state, { type: "connected", connected: false });
    assert.equal(state.pendingCreate?.outcome, expected);
    state = reduce(state, { type: "connected", connected: true });
    state = reduce(state, {
      type: "selecting",
      cwd: "/scratch",
      sessionId: "new",
      selectionId: "reattach",
    });
    state = reduce(state, {
      type: "server",
      message: {
        ...selected,
        selectionId: "reattach",
        snapshot: {
          ...selected.snapshot,
          state: { ...selected.snapshot.state, submission: { id: 1, outcome } },
        },
      },
    });
    state = reduce(state, {
      type: "server",
      message: {
        _tag: "session",
        selectionId: "reattach",
        cursor: { ...selected.cursor!, sequence: 1 },
        event: {
          _tag: "closed",
          closure: { _tag: "exited", code: 1, detail: "process exited with code 1" },
        },
      },
    });
    assert.equal(
      state.pendingCreate?.outcome,
      expected,
      "worker exit is separate from prompt delivery",
    );
    assert.equal(state.pendingCreate?.text, "original input");
    assert.equal(state.session?.hosted, false);
  }
});

test("INV-03: a child exit before first input reaches history ends Starting without losing the input", () => {
  const selected = emptyCreated();
  let state = reduce(beginCreate(), { type: "server", message: selected });
  state = reduce(state, {
    type: "server",
    message: {
      _tag: "session",
      selectionId: "create",
      cursor: { ...selected.cursor!, sequence: 1 },
      event: {
        _tag: "closed",
        closure: { _tag: "exited", code: 1, detail: "process exited with code 1" },
      },
    },
  });
  assert.equal(state.pendingCreate?.outcome, "uncertain");
  assert.equal(state.pendingCreate?.text, "original input");
  assert.equal(state.pendingCreate?.detail, "process exited with code 1");
  assert.equal(state.session?.hosted, false);
});
