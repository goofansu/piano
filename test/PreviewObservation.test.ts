import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientCommand, ServerMessage, SessionPreview, SessionState } from "../shared/wire.ts";
import { createPreviewObservation } from "../web/src/lib/previewObservation.ts";
import { type AppState, initialState } from "../web/src/store.ts";

const app: SessionPreview = {
  instanceId: "i1",
  state: "running",
  ready: true,
  url: "http://localhost:5173/",
  port: 5173,
  command: ["npm", "run", "dev"],
  detail: "",
  externalAccess: "same-host",
  observedAt: 0,
};
const page = (state: Partial<SessionState> = {}, hosted = true): AppState => ({
  ...initialState,
  connected: true,
  selectionId: "sel-1",
  view: { kind: "session" },
  session: {
    cwd: "/repo",
    sessionId: "s1",
    hosted,
    cursor: null,
    state: { sessionId: "s1", isStreaming: false, ...state },
    messages: [],
    dialogs: [],
  },
});

function fakeSource(initial: AppState) {
  let state = initial;
  const sent: ClientCommand[] = [];
  const updates = new Set<() => void>();
  const messages = new Set<(m: ServerMessage) => void>();
  let focus = () => {};
  let clock = 0;
  const source = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      updates.add(listener);
      return () => updates.delete(listener);
    },
    send: (command: ClientCommand) => {
      sent.push(command);
      return "sent" as const;
    },
    listen: (listener: (m: ServerMessage) => void) => {
      messages.add(listener);
      return () => messages.delete(listener);
    },
  };
  const notices: string[] = [];
  const observation = createPreviewObservation({
    environment: {
      onFocus: (listener) => {
        focus = listener;
        return () => {};
      },
    },
    now: () => clock,
  });
  observation.follow(source, (message) => notices.push(message));
  return {
    observation,
    sent,
    notices,
    set: (next: AppState) => {
      state = next;
      for (const listener of updates) listener();
    },
    deliver: (m: ServerMessage) => {
      for (const listener of messages) listener(m);
    },
    focus: (at: number) => {
      clock = at;
      focus();
    },
  };
}

const STATUS = { _tag: "act", action: { _tag: "preview_status" } };

test("an attachment to a session that owns an app re-observes it once; reconnecting observes again", () => {
  const f = fakeSource(page({ preview: app }));
  assert.deepEqual(f.sent, [STATUS]);
  f.set({ ...page({ preview: { ...app, state: "failed" } }) });
  assert.equal(f.sent.length, 1, "a state change within one attachment does not read again");
  f.set({ ...page({ preview: app }), selectionId: "sel-2" });
  assert.equal(f.sent.length, 2);
});

test("nothing is observed for a session without an app, a peek, a closed session or while resyncing", () => {
  for (const state of [
    page(),
    page({ preview: app }, false),
    page({ preview: app, closure: { _tag: "released", detail: "" } }),
    { ...page({ preview: app }), resync: true },
  ]) {
    const f = fakeSource(state);
    f.focus(60_000);
    f.observation.refresh();
    assert.deepEqual(f.sent, []);
  }
});

test("returning to the page re-observes at most every ten seconds", () => {
  const f = fakeSource(page({ preview: app }));
  f.focus(20_000);
  f.focus(25_000);
  f.focus(31_000);
  assert.equal(f.sent.length, 3);
});

test("details keep only the on-screen session's answer; stops are reported as they ended", () => {
  const f = fakeSource(page({ preview: app }));
  assert.equal(f.observation.getState().refreshing, true);
  f.deliver({
    _tag: "action_result",
    cwd: "/repo",
    sessionId: "other",
    result: { _tag: "preview_observed", instanceId: "x", logs: "not mine" },
  });
  assert.equal(f.observation.getState().details, null);
  f.deliver({
    _tag: "action_result",
    cwd: "/repo",
    sessionId: "s1",
    result: { _tag: "preview_observed", instanceId: "i1", logs: "ready in 200ms" },
  });
  assert.deepEqual(f.observation.getState(), {
    refreshing: false,
    details: { cwd: "/repo", sessionId: "s1", instanceId: "i1", logs: "ready in 200ms" },
  });
  for (const outcome of ["stopped", "not-current"] as const)
    f.deliver({
      _tag: "action_result",
      cwd: "/repo",
      sessionId: "s1",
      result: { _tag: "preview_stopped", instanceId: "i1", outcome },
    });
  assert.deepEqual(f.notices, [
    "Preview stopped",
    "That preview had already stopped or been replaced.",
  ]);
});
