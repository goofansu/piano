import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientCommand, ServerMessage, SessionPreview, SessionState } from "../shared/wire.ts";
import { createPreviewObservation } from "../web/src/lib/previewObservation.ts";
import { selectedPreview } from "../web/src/lib/sessionPreview.ts";
import type { SendDisposition } from "../web/src/lib/ws.ts";
import { type AppState, initialState, reduce } from "../web/src/store.ts";

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
    cursor: { cwd: "/repo", sessionId: "s1", generation: "g1", sequence: 1 },
    state: { sessionId: "s1", isStreaming: false, ...state },
    messages: [],
    dialogs: [],
  },
});

function fakeSource(initial: AppState, disposition: SendDisposition = "sent") {
  let state = initial;
  const sent: ClientCommand[] = [];
  const updates = new Set<() => void>();
  const messages = new Set<(m: ServerMessage) => void>();
  let focus = () => {};
  let clock = 0;
  let onSend = () => {};
  const source = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      updates.add(listener);
      return () => updates.delete(listener);
    },
    send: (command: ClientCommand) => {
      sent.push(command);
      onSend();
      return disposition;
    },
    listen: (listener: (m: ServerMessage) => void) => {
      messages.add(listener);
      return () => messages.delete(listener);
    },
  };
  const notices: { message: string; level: string }[] = [];
  let requests = 0;
  const observation = createPreviewObservation({
    newRequestId: () => `r${++requests}`,
    environment: {
      onFocus: (listener) => {
        focus = listener;
        return () => {
          focus = () => {};
        };
      },
    },
    now: () => clock,
  });
  const stop = observation.follow(source, (message, level) => notices.push({ message, level }));
  return {
    observation,
    source,
    stop,
    sent,
    notices,
    onSend: (listener: () => void) => {
      onSend = listener;
    },
    set: (next: AppState) => {
      state = next;
      for (const listener of updates) listener();
    },
    deliver: (m: ServerMessage) => {
      // The server echoes the request being answered; callers can supply an obsolete ID.
      const latest = sent.at(-1);
      if (
        m._tag === "action_result" &&
        m.result._tag === "preview_observed" &&
        m.result.requestId === undefined &&
        latest?._tag === "act" &&
        latest.action._tag === "preview_status"
      )
        m = { ...m, result: { ...m.result, requestId: latest.action.requestId } };
      for (const listener of messages) listener(m);
    },
    focus: (at: number) => {
      clock = at;
      focus();
    },
  };
}

const STATUS = { _tag: "act", action: { _tag: "preview_status", requestId: "r1" } };
const observed = (instanceId: string | null = "i1", logs = "ready in 200ms"): ServerMessage => ({
  _tag: "action_result",
  cwd: "/repo",
  sessionId: "s1",
  result: { _tag: "preview_observed", instanceId, logs },
});
const stopped = (
  outcome: "stopped" | "cleared" | "not-current" = "stopped",
  instanceId = "i1",
): ServerMessage => ({
  _tag: "action_result",
  cwd: "/repo",
  sessionId: "s1",
  result: { _tag: "preview_stopped", instanceId, outcome },
});
const empty = { refreshing: false, details: null, terminal: null };

test("an attachment observes once; changed session state does not poll; reattachment reads again", () => {
  const f = fakeSource(page({ preview: app }));
  assert.deepEqual(f.sent, [STATUS]);
  f.set(page({ preview: { ...app, state: "failed" } }));
  assert.equal(f.sent.length, 1);
  f.deliver(observed());
  f.set(page({ preview: { ...app, observedAt: 10 } }));
  assert.equal(f.sent.length, 1);
  f.set({ ...page({ preview: app }), selectionId: "sel-2" });
  assert.equal(f.sent.length, 2);
  assert.equal(f.observation.getState().details, null);
});

test("a late same-instance reply cannot settle a newer attachment's read", () => {
  const f = fakeSource(page({ preview: app }));
  f.set({ ...page({ preview: app }), selectionId: "sel-2" });
  f.deliver({
    _tag: "action_result",
    cwd: "/repo",
    sessionId: "s1",
    result: { _tag: "preview_observed", requestId: "r1", instanceId: "i1", logs: "obsolete" },
  });
  assert.equal(f.observation.getState().refreshing, true);
  assert.equal(f.observation.getState().details, null);
  f.deliver(observed("i1", "current"));
  assert.equal(f.observation.getState().details?.logs, "current");
});

test("nothing is observed without an app, for a peek, a closed session or while resyncing", () => {
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
    assert.deepEqual(f.observation.getState(), empty);
  }
});

test("concurrent manual and focus reads share the attachment's outstanding observation", () => {
  const f = fakeSource(page({ preview: app }));
  f.observation.refresh();
  f.observation.refresh();
  f.focus(20_000);
  assert.deepEqual(f.sent, [STATUS]);
  assert.equal(f.observation.getState().refreshing, true);
  f.deliver(observed());
  assert.equal(f.observation.getState().refreshing, false);
  f.observation.refresh();
  assert.equal(f.sent.length, 2, "a completed read does not suppress an explicit refresh");
});

test("returning to the page re-observes at most every ten seconds, independently of manual reads", () => {
  const f = fakeSource(page({ preview: app }));
  f.deliver(observed());
  f.focus(20_000);
  f.deliver(observed());
  f.focus(25_000);
  assert.equal(f.sent.length, 2);
  f.observation.refresh();
  f.deliver(observed());
  f.focus(29_999);
  assert.equal(f.sent.length, 3);
  f.focus(30_000);
  assert.equal(f.sent.length, 4);
});

test("details and refreshing belong to the exact workspace, session and current instance", () => {
  const f = fakeSource(page({ preview: app }));
  for (const message of [
    { ...observed(), cwd: "/other" },
    { ...observed(), sessionId: "other" },
    observed("other", "other app logs"),
    observed(null),
  ]) {
    f.deliver(message);
    assert.equal(f.observation.getState().details, null);
    assert.equal(f.observation.getState().refreshing, true);
  }
  f.deliver(observed());
  assert.deepEqual(f.observation.getState(), {
    ...empty,
    details: { cwd: "/repo", sessionId: "s1", instanceId: "i1", logs: "ready in 200ms" },
  });
  f.deliver(observed("i1", "unsolicited stale answer"));
  assert.equal(f.observation.getState().details?.logs, "ready in 200ms");
});

test("replacement clears old logs and a late old-instance reply cannot settle its new read", () => {
  const f = fakeSource(page({ preview: app }));
  f.deliver(observed());
  f.observation.refresh();
  f.set(page({ preview: { ...app, instanceId: "i2" } }));
  assert.equal(f.observation.getState().details, null);
  assert.equal(f.sent.length, 3);
  f.deliver(observed());
  assert.equal(f.observation.getState().refreshing, true);
  assert.equal(f.observation.getState().details, null);
  f.deliver(observed("i2", "new app"));
  assert.equal(f.observation.getState().details?.logs, "new app");
  assert.equal(f.observation.getState().refreshing, false);
  f.deliver(observed());
  assert.equal(f.observation.getState().details?.instanceId, "i2");
});

test("selection, owner generation and ownership loss discard details and outstanding reads", () => {
  const original = page({ preview: app });
  const session = original.session!;
  for (const next of [
    { ...original, selecting: { cwd: "/other", sessionId: "other" } },
    { ...original, session: { ...session, cwd: "/other" } },
    { ...original, session: { ...session, cursor: { ...session.cursor!, generation: "g2" } } },
    { ...original, resync: true },
    page({ preview: app }, false),
    page({ preview: app, closure: { _tag: "released", detail: "" } }),
    page(),
  ]) {
    const f = fakeSource(original);
    f.deliver(observed());
    f.observation.refresh();
    f.set(next);
    assert.equal(f.observation.getState().details, null);
    const ready = f.observation.getState().refreshing;
    f.deliver(observed("obsolete", "old logs"));
    assert.equal(f.observation.getState().details, null);
    assert.equal(f.observation.getState().refreshing, ready);
  }
});

test("disconnect is unknown, clears details, ignores late answers and reconnect observes again", () => {
  const original = page({ preview: app });
  const f = fakeSource(original);
  f.deliver(observed());
  f.observation.refresh();
  const disconnected = reduce(original, { type: "connected", connected: false });
  f.set(disconnected);
  assert.deepEqual(f.observation.getState(), empty);
  const unknown = selectedPreview(disconnected)!;
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.ready, false);
  assert.equal(unknown.url, null);
  assert.equal(unknown.instanceId, "i1", "disconnect does not claim that the app stopped");
  assert.equal(original.session!.state.preview, app, "the projection never rewrites server facts");
  f.deliver(observed());
  f.observation.refresh();
  assert.deepEqual(f.observation.getState(), empty);
  f.set({ ...disconnected, connected: true });
  assert.equal(f.sent.length, 2, "a connected socket is not yet an attachment");
  f.set({ ...original, selectionId: "sel-2" });
  assert.equal(f.sent.length, 3);
  f.deliver(observed());
  assert.equal(f.observation.getState().details?.instanceId, "i1");
});

test("observation errors settle the matching read, retain unknown rather than stopped, and allow retry", () => {
  const f = fakeSource(page({ preview: app }));
  f.set(page({ preview: { ...app, state: "unknown", ready: false, url: null } }));
  f.deliver({
    _tag: "action_result",
    cwd: "/repo",
    sessionId: "s1",
    result: { _tag: "preview_observed", instanceId: "i1", logs: "", error: "Unavailable" },
  });
  assert.equal(f.observation.getState().details?.error, "Unavailable");
  assert.equal(f.observation.getState().refreshing, false);
  assert.equal(f.observation.getState().terminal, null);
  f.observation.refresh();
  assert.equal(f.sent.length, 2);
});

test("unsent reads can retry; uncertain reads coalesce; synchronous disconnect cannot restore loading", () => {
  const unsent = fakeSource(page({ preview: app }), "not-sent");
  assert.equal(unsent.observation.getState().refreshing, false);
  unsent.observation.refresh();
  assert.equal(unsent.sent.length, 2);
  const uncertain = fakeSource(page({ preview: app }), "uncertain");
  uncertain.observation.refresh();
  assert.equal(uncertain.sent.length, 1);
  const f = fakeSource(page({ preview: app }));
  f.deliver(observed());
  f.onSend(() => f.set({ ...page({ preview: app }), connected: false }));
  f.observation.refresh();
  assert.deepEqual(f.observation.getState(), empty);
});

test("confirmed stop leaves a disposable exact-instance terminal and notifies success once", () => {
  for (const outcome of ["stopped", "cleared"] as const) {
    const f = fakeSource(page({ preview: app }));
    f.deliver(observed());
    f.observation.refresh();
    f.set(page()); // The server publishes preview removal before the action result.
    f.deliver(stopped(outcome));
    f.deliver(stopped(outcome));
    assert.deepEqual(f.notices, [{ message: "Preview stopped", level: "success" }]);
    assert.deepEqual(f.observation.getState(), {
      ...empty,
      terminal: { cwd: "/repo", sessionId: "s1", instanceId: "i1", state: "stopped" },
    });
    f.deliver(observed());
    f.observation.refresh();
    assert.equal(f.observation.getState().details, null);
    assert.equal(f.observation.getState().terminal?.state, "stopped");
    f.set(page({ preview: { ...app, instanceId: "i2" } }));
    assert.equal(f.observation.getState().terminal, null);
    assert.equal(f.observation.getState().refreshing, true);
  }
});

test("not-current is informational; an old stop never marks a replacement as stopped", () => {
  const f = fakeSource(page({ preview: app }));
  f.set(page({ preview: { ...app, instanceId: "i2" } }));
  f.deliver(stopped("not-current"));
  f.deliver(stopped("not-current"));
  assert.deepEqual(f.notices, [
    { message: "That preview had already stopped or been replaced.", level: "info" },
  ]);
  assert.equal(f.observation.getState().terminal, null);
  f.deliver(stopped());
  assert.equal(f.observation.getState().terminal, null);
  assert.equal(f.observation.getState().refreshing, true);
  f.deliver(observed("i2", "replacement"));
  assert.equal(f.observation.getState().details?.logs, "replacement");
});

test("terminal records cannot follow a changed attachment or owner, disconnect or unfollow", () => {
  for (const next of [
    { ...page(), selectionId: "sel-2" },
    { ...page(), connected: false },
    page({}, false),
    page({ closure: { _tag: "released", detail: "" } }),
  ]) {
    const f = fakeSource(page({ preview: app }));
    f.set(page());
    f.deliver(stopped());
    assert.notEqual(f.observation.getState().terminal, null);
    f.set(next);
    assert.deepEqual(f.observation.getState(), empty);
    f.deliver(stopped());
    assert.equal(f.observation.getState().terminal, null);
  }
  const f = fakeSource(page({ preview: app }));
  f.set(page());
  f.deliver(stopped());
  f.stop();
  assert.deepEqual(f.observation.getState(), empty);
  f.focus(20_000);
  f.observation.refresh();
  f.deliver(observed());
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.observation.getState(), empty);
});

test("following again disposes the previous source; its late cleanup cannot dispose the new one", () => {
  const first = fakeSource(page({ preview: app }));
  const second = fakeSource(page({ preview: { ...app, instanceId: "i2" } }));
  const stop = first.observation.follow(second.source, () => {});
  first.stop();
  first.deliver(observed());
  assert.equal(first.observation.getState().refreshing, true);
  second.deliver(observed("i2", "new source"));
  assert.equal(first.observation.getState().details?.logs, "new source");
  stop();
  assert.deepEqual(first.observation.getState(), empty);
});
