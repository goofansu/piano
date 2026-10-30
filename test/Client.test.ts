import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage, Dialog, ServerMessage, SessionClosure } from "../shared/wire.ts";
import { createClient, type NotifyLevel } from "../web/src/lib/client.ts";
import { trustCommand } from "../web/src/lib/globalCommands.ts";
import { createDialogAnswer, pendingDialogs } from "../web/src/lib/piDialogs.ts";
import type { ConnectionHandlers, DisconnectReason, SendDisposition } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

/** A client over a fake transport: the test plays the server and the socket's status changes. */
function harness() {
  const sent: ClientMessage[] = [];
  const notes: Array<[string, NotifyLevel | undefined]> = [];
  let handlers: ConnectionHandlers | undefined;
  let ids = 0;
  let disposition: SendDisposition = "sent";
  const client = createClient({
    initial: initialState,
    connect: (h) => {
      handlers = h;
      return {
        send: (m) => {
          if (disposition !== "not-sent") sent.push(m);
          if (disposition !== "sent") h.onStatus(false);
          return disposition;
        },
        close: () => {},
      };
    },
    notify: (message, level) => notes.push([message, level]),
    newSelectionId: () => `sel${++ids}`,
  });
  client.start();
  const server = (m: ServerMessage) => handlers!.onMessage(m);
  const status = (connected: boolean, reason?: DisconnectReason) =>
    handlers!.onStatus(connected, reason);
  const selects = () => sent.filter((m) => m._tag === "select");
  const lastSelectionId = () => client.getState().selectionId!;
  const selected = (sessionId: string, sequence = 1, generation = "g1"): ServerMessage => ({
    _tag: "selected",
    cwd: "/scratch",
    sessionId,
    selectionId: lastSelectionId(),
    hosted: true,
    cursor: { cwd: "/scratch", sessionId, generation, sequence },
    snapshot: {
      state: { sessionId, isStreaming: false },
      messages: [{ id: "m1", role: "user", text: "kept" }],
      dialogs: [],
    },
  });
  const event = (
    sequence: number,
    e: Extract<ServerMessage, { _tag: "session" }>["event"],
    selectionId = lastSelectionId(),
  ): ServerMessage => ({
    _tag: "session",
    selectionId,
    cursor: { cwd: "/scratch", sessionId: "a", generation: "g1", sequence },
    event: e,
  });
  return {
    client,
    sent,
    notes,
    server,
    status,
    selects,
    selected,
    event,
    transport: (result: SendDisposition) => {
      disposition = result;
    },
  };
}

const act = { _tag: "act", action: { _tag: "abort" } } as const;

for (const disposition of ["not-sent", "sent", "uncertain"] as const) {
  test(`question answer ${disposition}: never replayed; answerable again while a new snapshot lists it`, () => {
    const h = harness();
    h.status(true);
    h.client.select("/scratch", "a");
    const dialog: Dialog = {
      id: "question",
      generation: "g1",
      method: "input",
      receivedAt: 0,
      deadlineAt: null,
      deadlineKind: "tool-end",
      toolCallId: "call-1",
    };
    const attach = (dialogs: Dialog[]) => {
      const selected = h.selected("a");
      assert.ok(selected._tag === "selected");
      h.server({ ...selected, snapshot: { ...selected.snapshot, dialogs } });
    };
    const reconnect = (dialogs: Dialog[]) => {
      h.status(false);
      h.transport("sent");
      h.status(true);
      assert.equal(pendingDialogs(h.client.getState()).attachment, null, "wait for reattachment");
      attach(dialogs);
    };
    attach([{ ...dialog }]);
    const rendered = pendingDialogs(h.client.getState());
    assert.equal(rendered.attachment, "sel1");
    const controller = createDialogAnswer({ dialog: rendered.head!, send: h.client.send });
    // The transport fails at click time, while the rendered attachment is still current.
    h.transport(disposition);
    const reply = { value: "keep this answer" };
    assert.equal(controller.answer(reply, 1_000, rendered.attachment), disposition !== "not-sent");
    const answers = () => h.sent.filter((m) => m._tag === "act" && m.action._tag === "answer");
    assert.equal(answers().length, disposition === "not-sent" ? 0 : 1);
    assert.equal(
      controller.view(1_000, pendingDialogs(h.client.getState()).attachment).disabled,
      true,
    );
    // The server never claimed it, so the new snapshot still lists the question.
    reconnect([{ ...dialog }]);
    const reconnected = pendingDialogs(h.client.getState());
    assert.deepEqual(reconnected.head, rendered.head, "same pending question and generation");
    assert.equal(reconnected.attachment, "sel2");
    assert.equal(answers().length, disposition === "not-sent" ? 0 : 1, "no automatic replay");
    assert.equal(controller.view(1_000, reconnected.attachment).disabled, false);
    assert.equal(controller.answer(reply, 1_000, reconnected.attachment), true);
    assert.equal(controller.cancel(1_000, reconnected.attachment), false);
    assert.equal(controller.abort(1_000, reconnected.attachment), false);
    assert.deepEqual(answers().at(-1), {
      _tag: "act",
      selectionId: "sel2",
      action: { _tag: "answer", id: dialog.id, generation: dialog.generation, ...reply },
    });
    // Once the server claims an answer, a snapshot no longer lists the question to answer.
    reconnect([]);
    assert.equal(pendingDialogs(h.client.getState()).head, undefined);
  });
}

for (const failure of ["selection_rejected", "selection_failed"] as const)
  for (const retained of [false, true]) {
    test(`${failure} ends attachment and permits explicit retry (retained=${retained})`, () => {
      const h = harness();
      h.status(true);
      h.client.select("/scratch", "a");
      if (retained) {
        h.server(h.selected("a"));
        h.status(false);
        h.status(true);
      }
      const before = h.selects().length;
      const selectionId = h.client.getState().selectionId!;
      h.client.select("/scratch", "a");
      assert.equal(h.selects().length, before, "pending selections are deduplicated");
      h.server({ _tag: failure, selectionId, message: "Attachment unavailable" });
      assert.equal(h.client.getState().selecting, null);
      assert.equal(h.client.getState().selectionId, null);
      assert.equal(h.client.getState().selectionFailure?.message, "Attachment unavailable");
      assert.equal(!!h.client.getState().session, retained);
      h.client.send(act);
      assert.equal(h.sent.filter((m) => m._tag === "act").length, 0);
      h.client.select("/scratch", "a");
      assert.equal(h.selects().length, before + 1);
      assert.notEqual(h.client.getState().selectionId, selectionId);
      h.server({ _tag: failure, selectionId, message: "Stale" });
      h.server({
        _tag: "error",
        selectionId: h.client.getState().selectionId!,
        message: "Action failure",
      });
      assert.ok(
        h.client.getState().selecting,
        "stale rejection and action error cannot settle attachment",
      );
      assert.equal(h.client.getState().selectionFailure, null);
      h.server(h.selected("a"));
      h.client.select("/scratch", "a");
      assert.equal(h.selects().length, before + 1, "ready selection is deduplicated");
    });
  }

test("a connection lost for falling behind or for its size tells the person; a plain loss is quiet", () => {
  const h = harness();
  h.status(true);
  h.status(false);
  assert.equal(h.notes.length, 0, "a plain loss only disables controls");
  h.status(true);
  h.status(false, "behind");
  assert.equal(h.client.getState().connected, false);
  h.status(true);
  h.status(false, "too-large");
  assert.deepEqual(
    h.notes.map(([, level]) => level),
    ["warning", "error"],
  );
  assert.match(h.notes[0]![0], /fell behind/i);
  assert.match(h.notes[1]![0], /delivery limit/i);
});

test("live state is current before paint, while local actions and disconnect notify renderers immediately", () => {
  const h = harness();
  h.status(true);
  let rendered = h.client.getState();
  let paint: (() => void) | undefined;
  const unsubscribe = h.client.subscribe((update) => {
    const render = () => {
      rendered = h.client.getState();
    };
    if (update === "live") paint = render;
    else render();
  });
  h.server({ _tag: "hosts", hosts: [{ cwd: "/scratch", sessionId: "a", working: true }] });
  assert.equal(rendered.hosts.length, 0, "rendering a live update may wait for a paint");
  assert.equal(h.client.getState().hosts.length, 1, "projection never waits for a paint");
  h.client.dispatch({ type: "new_directory", cwd: "/scratch" });
  assert.equal(rendered, h.client.getState(), "a local action must not wait for a paint");
  h.server({ _tag: "hosts", hosts: [] });
  h.status(false);
  assert.equal(
    rendered.connected,
    false,
    "disconnect disables controls without waiting for a paint",
  );
  paint?.();
  assert.equal(rendered, h.client.getState(), "a later paint cannot restore stale state");
  unsubscribe();
});

test("INV-02/05: a dropped connection re-selects the session exactly once and keeps its transcript", () => {
  const h = harness();
  h.status(true);
  assert.equal(h.selects().length, 0, "nothing to re-attach before a selection");
  h.client.select("/scratch", "a");
  h.server(h.selected("a"));
  h.client.select("/scratch", "a");
  assert.equal(h.selects().length, 1, "selecting the session already on screen is a no-op");

  h.status(false);
  h.status(true);
  assert.deepEqual(
    h.selects().map((m) => [m.sessionId, m.selectionId]),
    [
      ["a", "sel1"],
      ["a", "sel2"],
    ],
  );
  assert.deepEqual(
    h.client.getState().session?.messages.map((m) => m.text),
    ["kept"],
    "the view is retained while re-attaching",
  );
  h.server(h.selected("a", 1));
  assert.equal(h.client.getState().selecting, null);
  assert.equal(h.selects().length, 2, "the fresh snapshot does not trigger another selection");
});

test("INV-05: a delivery gap re-selects once, and further gapped frames do not pile up selections", () => {
  const h = harness();
  h.status(true);
  h.client.select("/scratch", "a");
  h.server(h.selected("a", 1));
  const stale = h.client.getState().selectionId!;
  h.server(h.event(3, { _tag: "notice", level: "info", message: "gap" }));
  assert.equal(h.selects().length, 2, "resync starts one fresh attachment");
  h.server(h.event(4, { _tag: "notice", level: "info", message: "late" }, stale));
  h.server(h.event(5, { _tag: "notice", level: "info", message: "later" }, stale));
  assert.equal(h.selects().length, 2);
  assert.deepEqual(h.notes, [], "rejected frames never notify");
});

test("INV-02/05: act is sent only on a ready attachment and carries its selection", () => {
  const h = harness();
  h.status(true);
  h.client.send(act);
  h.client.select("/scratch", "a");
  h.client.send(act);
  assert.equal(
    h.sent.filter((m) => m._tag === "act").length,
    0,
    "no act before the selection's snapshot",
  );
  h.server(h.selected("a"));
  h.client.send(act);
  assert.deepEqual(
    h.sent.filter((m) => m._tag === "act").map((m) => m.selectionId),
    ["sel1"],
  );

  h.status(false);
  h.client.send(act);
  h.status(true);
  h.client.send(act);
  assert.equal(
    h.sent.filter((m) => m._tag === "act").length,
    1,
    "no act on a lost or re-selecting attachment",
  );
  h.server(h.selected("a"));
  h.client.send(act);
  assert.deepEqual(
    h.sent.filter((m) => m._tag === "act").map((m) => m.selectionId),
    ["sel1", "sel2"],
  );
});

test("notifications: applied session notices notify; rejected frames do not", () => {
  const h = harness();
  h.status(true);
  h.client.select("/scratch", "a");
  h.server(h.selected("a", 1));
  h.server(h.event(2, { _tag: "notice", level: "warning", message: "applied" }));
  h.server(h.event(2, { _tag: "notice", level: "warning", message: "duplicate" }));
  h.server({ _tag: "toast", level: "info", message: "server toast" });
  h.server({ _tag: "error", message: "boom" });
  assert.deepEqual(h.notes, [
    ["applied", "warning"],
    ["server toast", "info"],
    ["boom", "error"],
  ]);
});

test("answer acceptance notifies once, only after confirmation; duplicate frames and snapshots stay quiet", () => {
  const h = harness();
  h.status(true);
  h.client.select("/scratch", "a");
  h.server(h.selected("a", 1));
  const receipt = (delivery: "pending" | "written" | "accepted") => ({
    _tag: "state" as const,
    state: {
      sessionId: "a",
      isStreaming: true,
      dialogResolution: {
        id: "question",
        generation: "g1",
        reason: "answered" as const,
        delivery,
        detail: "receipt",
        answer: { title: "Question", value: "Answer" },
      },
    },
  });
  h.server(h.event(2, receipt("pending")));
  h.server(h.event(3, receipt("written")));
  assert.deepEqual(h.notes, [], "a write alone never earns an acceptance toast");
  h.server(h.event(4, receipt("accepted")));
  h.server(h.event(4, receipt("accepted")));
  h.server(h.event(5, receipt("accepted")));
  h.server(
    h.event(6, {
      _tag: "snapshot",
      snapshot: { state: receipt("accepted").state, messages: [], dialogs: [] },
    }),
  );
  assert.deepEqual(h.notes, [["Answer accepted", "success"]]);
});

test("trust changes on screen notify once; initial results and other directories stay quiet", () => {
  const h = harness();
  const trust = (cwd: string, trusted: boolean) =>
    h.server({ _tag: "trust", cwd, trust: { required: true, trusted } });
  h.status(true);
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  trust("/a", false);
  trust("/b", false);
  assert.deepEqual(h.notes, []);
  trust("/a", true);
  trust("/a", true);
  trust("/b", true);
  assert.deepEqual(h.notes, [["Pi marked this folder as trusted.", "info"]]);
  trust("/a", false);
  assert.deepEqual(h.notes[1], ["Pi marked this folder as untrusted.", "info"]);
  h.client.dispatch({ type: "new_directory", cwd: "/b" });
  trust("/b", false);
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  trust("/a", true);
  h.status(false);
  h.status(true);
  trust("/a", false);
  assert.deepEqual(
    h.notes.slice(2),
    [
      ["Pi marked this folder as untrusted.", "info"],
      ["Pi marked this folder as trusted.", "info"],
      ["Pi marked this folder as untrusted.", "info"],
    ],
    "switching and reconnecting still explain changes from the displayed value",
  );
});

test("the first probe explains a change from the directory trust already displayed", () => {
  const h = harness();
  h.status(true);
  h.server({
    _tag: "registry",
    folders: [
      {
        path: "/repo",
        name: "repo",
        discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
        worktrees: [
          {
            path: "/a",
            workspace: { id: "ws-a", folder: "/repo", path: "/a" },
            branch: "feature",
            root: false,
            status: "current",
            trust: { required: true, trusted: false },
          },
        ],
      },
    ],
    projects: [],
  });
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: true } });
  assert.deepEqual(h.notes, [["Pi marked this folder as trusted.", "info"]]);
});

test("manual trust changes keep their confirmation without an automatic-change toast", () => {
  const h = harness();
  const trust = (trusted: boolean, requested?: boolean) =>
    h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted }, requested });
  h.status(true);
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  trust(false);
  h.client.send({ _tag: "set_trust", path: "/a", trusted: true });
  trust(false); // An older probe can finish before the explicit decision.
  h.server({ _tag: "catalogs_invalidated" });
  trust(true); // The refresh can win the race with the explicit response.
  h.server({ _tag: "toast", level: "success", message: "Trusted." });
  trust(true, true);
  assert.deepEqual(h.notes, [["Trusted.", "success"]]);
  trust(false);
  assert.deepEqual(h.notes[1], ["Pi marked this folder as untrusted.", "info"]);
  h.client.send({ _tag: "set_trust", path: "/a", trusted: true });
  h.server({ _tag: "trust_failed", cwd: "/a", message: "Could not save trust" });
  trust(true);
  assert.deepEqual(h.notes.at(-1), ["Pi marked this folder as trusted.", "info"]);
});

test("a reversed manual decision settles without duplicate or permanently suppressed notices", () => {
  const h = harness();
  h.status(true);
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: true } });
  h.client.send({ _tag: "set_trust", path: "/a", trusted: false });
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: false } });
  assert.equal(
    trustCommand(h.client.getState(), "/a")?.pressed,
    true,
    "a temporary probe must not change the pending label",
  );
  assert.equal(
    h.client.getState().trusts["/a"]?.trusted,
    false,
    "the live observation is still recorded",
  );
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: true } });
  h.server({ _tag: "toast", level: "warning", message: "Pi changed this folder back to trusted." });
  h.server({
    _tag: "trust",
    cwd: "/a",
    trust: { required: true, trusted: true },
    requested: false,
  });
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: true } });
  assert.deepEqual(h.notes, [["Pi changed this folder back to trusted.", "warning"]]);
  assert.equal(trustCommand(h.client.getState(), "/a")?.pressed, true);
  assert.equal(trustCommand(h.client.getState(), "/a")?.pending, false);
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: false } });
  assert.deepEqual(h.notes.at(-1), ["Pi marked this folder as untrusted.", "info"]);
});

test("trust decisions disable every command surface immediately and reject repeat sends until their reply", () => {
  const h = harness();
  h.status(true);
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: false } });
  h.server({ _tag: "trust", cwd: "/b", trust: { required: true, trusted: false } });
  let updated = false;
  h.client.subscribe((update) => {
    if (update === "immediate") updated = true;
  });
  const request = { _tag: "set_trust", path: "/a", trusted: true } as const;
  h.client.send(request);
  assert.equal(updated, true, "pending feedback does not wait for a server frame or paint");
  assert.equal(trustCommand(h.client.getState(), "/a")?.pending, true);
  assert.equal(trustCommand(h.client.getState(), "/a")?.enabled, false);
  assert.equal(trustCommand(h.client.getState(), "/a")?.pressed, false, "no optimistic trust");
  assert.equal(trustCommand(h.client.getState(), "/b")?.enabled, true);
  h.client.dispatch({ type: "new_directory", cwd: "/b" });
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  h.client.send(request);
  h.client.send({ ...request, trusted: false });
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: true } });
  h.client.send(request);
  assert.equal(h.sent.filter((m) => m._tag === "set_trust").length, 1);
  assert.equal(trustCommand(h.client.getState(), "/a")?.pending, true, "a probe is not a receipt");
  assert.equal(
    trustCommand(h.client.getState(), "/a")?.pressed,
    false,
    "keep the pre-click label until the decision reply",
  );
  h.server({ _tag: "trust", cwd: "/b", trust: { required: true, trusted: true }, requested: true });
  assert.equal(
    trustCommand(h.client.getState(), "/a")?.pending,
    true,
    "another directory cannot settle it",
  );
  h.server({
    _tag: "trust",
    cwd: "/a",
    trust: { required: true, trusted: false },
    requested: true,
  });
  assert.equal(
    trustCommand(h.client.getState(), "/a")?.pending,
    false,
    "even a reversed decision settles",
  );
  assert.equal(trustCommand(h.client.getState(), "/a")?.enabled, true);
  h.client.send(request);
  assert.equal(h.sent.filter((m) => m._tag === "set_trust").length, 2);
  h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: true }, requested: true });
  assert.equal(
    trustCommand(h.client.getState(), "/a")?.pressed,
    true,
    "a successful decision replaces the snapshot",
  );
  assert.equal(trustCommand(h.client.getState(), "/a")?.pending, false);
});

for (const ending of ["error", "disconnect"] as const) {
  test(`trust pending ends on ${ending} without replaying the decision`, () => {
    const h = harness();
    h.status(true);
    h.client.dispatch({ type: "new_directory", cwd: "/a" });
    h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: true } });
    const request = { _tag: "set_trust", path: "/a", trusted: false } as const;
    h.client.send(request);
    h.server({ _tag: "trust", cwd: "/a", trust: { required: true, trusted: false } });
    assert.equal(trustCommand(h.client.getState(), "/a")?.pressed, true);
    h.server({ _tag: "error", selectionId: "unrelated", message: "Session error" });
    h.server({ _tag: "error", message: "Could not rename session" });
    h.server({ _tag: "trust_failed", cwd: "/b", message: "Could not save trust" });
    assert.equal(
      trustCommand(h.client.getState(), "/a")?.pending,
      true,
      "only this decision's own failure settles it",
    );
    if (ending === "error") {
      h.server({ _tag: "trust_failed", cwd: "/a", message: "Could not save trust" });
      assert.deepEqual(h.notes.at(-1), ["Could not save trust", "error"]);
    } else {
      h.status(false);
      assert.equal(trustCommand(h.client.getState(), "/a")?.pending, false);
      h.client.send(request);
      assert.equal(
        h.sent.filter((m) => m._tag === "set_trust").length,
        1,
        "offline sends are dropped",
      );
      h.status(true);
    }
    assert.equal(trustCommand(h.client.getState(), "/a")?.pending, false);
    assert.equal(
      trustCommand(h.client.getState(), "/a")?.pressed,
      false,
      "ending pending reveals the latest observation",
    );
    assert.equal(trustCommand(h.client.getState(), "/a")?.enabled, true);
    assert.equal(h.sent.filter((m) => m._tag === "set_trust").length, 1);
    h.client.send(request);
    assert.equal(h.sent.filter((m) => m._tag === "set_trust").length, 2);
  });
}

test("INV-02: a closure notifies by its kind, never by its wording", () => {
  const cases: Array<[SessionClosure, boolean]> = [
    [{ _tag: "released", detail: "Pi was released" }, false],
    [{ _tag: "exited", code: 0, detail: "Pi exited with code 0" }, false],
    [{ _tag: "stopped", detail: "Pi was stopped during work" }, false],
    [{ _tag: "released_during_work", detail: "Pi was released during work" }, true],
    [{ _tag: "exited", code: 1, detail: "Pi exited with code 1: lock released" }, true],
    [{ _tag: "failed", detail: "Pi exit could not be observed" }, true],
  ];
  for (const [closure, notifies] of cases) {
    const h = harness();
    h.status(true);
    h.client.select("/scratch", "a");
    h.server(h.selected("a", 1));
    h.server(h.event(2, { _tag: "closed", closure }));
    assert.deepEqual(
      h.notes,
      notifies ? [[`Pi stopped: ${closure.detail}`, "warning"]] : [],
      closure._tag,
    );
    assert.equal(h.client.getState().session?.state.closure, closure);
  }
});

test("create_session mints a selection and shows the first message until Pi records it", () => {
  const h = harness();
  h.status(true);
  h.client.send({ _tag: "create_session", cwd: "/scratch", options: {}, text: "hello" });
  const created = h.sent.find((m) => m._tag === "create_session");
  assert.equal(created?.selectionId, "sel1");
  assert.equal(h.client.getState().pendingCreate?.text, "hello");
  assert.equal(h.client.getState().view.kind, "session");
});

for (const failure of ["selection_rejected", "selection_failed"] as const)
  test(`${failure} on reattachment preserves uncertain first-message delivery and never resends creation`, () => {
    const h = harness();
    h.status(true);
    h.client.send({ _tag: "create_session", cwd: "/scratch", options: {}, text: "might execute" });
    const selected = h.selected("a");
    assert.ok(selected._tag === "selected");
    h.server({ ...selected, snapshot: { ...selected.snapshot, messages: [] } });
    h.status(false);
    const uncertain = h.client.getState().pendingCreate;
    assert.equal(uncertain?.outcome, "uncertain");
    h.status(true);
    h.server({
      _tag: failure,
      selectionId: h.client.getState().selectionId!,
      message: "Attachment unavailable",
    });
    assert.deepEqual(h.client.getState().pendingCreate, uncertain);
    assert.equal(h.client.getState().selecting, null);
    assert.equal(h.client.getState().selectionFailure?.message, "Attachment unavailable");
    h.client.select("/scratch", "a");
    assert.deepEqual(h.client.getState().pendingCreate, uncertain);
    assert.equal(h.sent.filter((m) => m._tag === "create_session").length, 1);
  });

test("rejected creation marks only its own first message as not started", () => {
  const h = harness();
  h.status(true);
  h.client.send({ _tag: "create_session", cwd: "/scratch", options: {}, text: "not sent" });
  h.server({
    _tag: "selection_rejected",
    selectionId: h.client.getState().selectionId!,
    message: "Creation was not started",
  });
  assert.equal(h.client.getState().pendingCreate?.outcome, "rejected");
  assert.equal(h.client.getState().pendingCreate?.detail, "Creation was not started");
});

/** What the client asked Pi about, as `tag cwd` pairs, since the last call. */
function focusHarness(options: { remembered?: string | null; initial?: typeof initialState } = {}) {
  const sent: ClientMessage[] = [];
  const written: string[] = [];
  let handlers: ConnectionHandlers | undefined;
  let ids = 0;
  const client = createClient({
    initial: options.initial ?? initialState,
    connect: (h) => {
      handlers = h;
      return {
        send: (m) => {
          sent.push(m);
          return "sent";
        },
        close: () => {},
      };
    },
    notify: () => {},
    newSelectionId: () => `sel${++ids}`,
    lastDirectory: { read: () => options.remembered ?? null, write: (cwd) => written.push(cwd) },
  });
  client.start();
  let seen = 0;
  const asked = () => {
    const out = sent
      .slice(seen)
      .filter((m) => m._tag === "models" || m._tag === "trust")
      .map((m) => `${m._tag} ${m.cwd}`);
    seen = sent.length;
    return out;
  };
  const server = (m: ServerMessage) => handlers!.onMessage(m);
  const status = (connected: boolean) => handlers!.onStatus(connected);
  const folder = (path: string) =>
    ({
      path,
      name: path.slice(1),
      worktrees: [],
      discovery: { status: "ready", observedAt: "", currentPath: path, worktrees: [] },
    }) as never;
  const selected = (cwd: string, checkoutMissing = false): ServerMessage => ({
    _tag: "selected",
    cwd,
    sessionId: "s",
    selectionId: client.getState().selectionId!,
    hosted: false,
    cursor: { cwd, sessionId: "s", generation: "g1", sequence: 1 },
    snapshot: {
      state: { sessionId: "s", isStreaming: false, checkoutMissing },
      messages: [],
      dialogs: [],
    },
  });
  return { client, asked, server, status, folder, selected, written };
}

test("INV-05: picking a New-page directory asks for its models and trust exactly once", () => {
  const h = focusHarness();
  h.status(true);
  assert.deepEqual(h.asked(), [], "no directory, nothing to ask");
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  assert.deepEqual(h.asked(), ["models /a", "trust /a"]);
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  h.client.dispatch({ type: "open", page: { kind: "new", projectId: "p1" } });
  assert.deepEqual(
    h.client.getState().view,
    { kind: "new", cwd: "/a", projectId: "p1" },
    "picking a project keeps the directory",
  );
  h.client.dispatch({ type: "open", page: { kind: "new", projectId: "p2" } });
  assert.deepEqual(h.asked(), [], "another project in the same directory asks nothing again");
  h.client.dispatch({ type: "new_directory", cwd: "/b" });
  assert.deepEqual(h.asked(), ["models /b", "trust /b"]);
});

test("INV-05: catalogs_invalidated and reconnect re-ask only for the focused directory", () => {
  const h = focusHarness();
  h.status(true);
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  h.client.select("/b", "s");
  h.server(h.selected("/b"));
  assert.deepEqual(
    h.asked(),
    ["models /a", "trust /a", "models /b", "trust /b"],
    "the selected session becomes the focus",
  );
  h.server({ _tag: "catalogs_invalidated" });
  assert.deepEqual(h.asked(), ["models /b", "trust /b"]);
  h.status(false);
  assert.deepEqual(h.asked(), [], "nothing is sent while disconnected");
  h.status(true);
  assert.deepEqual(
    h.asked(),
    ["models /b", "trust /b"],
    "a reconnect asks once for the session still on screen",
  );
  h.server(h.selected("/b"));
  assert.deepEqual(h.asked(), [], "the re-selection's snapshot does not ask again");
});

test("a session whose checkout was removed asks Pi nothing", () => {
  const h = focusHarness();
  h.status(true);
  h.client.select("/gone", "s");
  h.server(h.selected("/gone", true));
  h.server({ _tag: "catalogs_invalidated" });
  assert.deepEqual(h.asked(), []);
});

test("a fresh New page starts in the last directory used, else the first folder, unless it belongs to a project", () => {
  const remembered = focusHarness({ remembered: "/last" });
  assert.deepEqual(remembered.client.getState().view, { kind: "new", cwd: "/last" });
  remembered.status(true);
  assert.deepEqual(remembered.asked(), ["models /last", "trust /last"]);
  remembered.client.send({ _tag: "create_session", cwd: "/next", options: {}, text: "hi" });
  assert.deepEqual(remembered.written, ["/next"], "creating a session remembers its directory");

  const first = focusHarness();
  first.status(true);
  first.server({ _tag: "registry", folders: [first.folder("/one"), first.folder("/two")] });
  assert.deepEqual(first.client.getState().view, { kind: "new", cwd: "/one" });

  const project = focusHarness({
    remembered: "/last",
    initial: { ...initialState, view: { kind: "new", projectId: "p1" } },
  });
  assert.deepEqual(
    project.client.getState().view,
    { kind: "new", projectId: "p1" },
    "a project's New page starts without a directory",
  );
});

test("a project's home starts in its most recent member's folder, at the folder's own checkout", () => {
  const worktree = (path: string, root: boolean) =>
    ({ workspace: { id: `ws:${path}`, folder: "/repo", path }, path, root }) as never;
  const repo = {
    path: "/repo",
    name: "repo",
    worktrees: [worktree("/repo", true), worktree("/repo.sort", false)],
    discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
  } as never;
  const at = (minute: number) => `2026-10-21T08:0${minute}:00Z`;
  const registry: ServerMessage = {
    _tag: "registry",
    folders: [repo],
    projects: [
      { id: "p1", name: "Perf" },
      { id: "p2", name: "Elsewhere" },
    ],
    sessionReferences: [
      sessionReference("/repo", "old", { projectId: "p1", updatedAt: at(1) }),
      sessionReference("/repo.sort", "recent", { projectId: "p1", updatedAt: at(5) }),
      sessionReference("/closed", "newest", { projectId: "p1", updatedAt: at(9) }),
      sessionReference("/closed", "only", { projectId: "p2", updatedAt: at(9) }),
    ],
  };
  const home = focusHarness({
    remembered: "/last",
    initial: { ...initialState, view: { kind: "project", projectId: "p1" } },
  });
  home.status(true);
  assert.deepEqual(home.asked(), [], "nothing to ask before the registry names the members");
  home.server(registry);
  assert.deepEqual(home.client.getState().view, { kind: "project", projectId: "p1", cwd: "/repo" });
  assert.deepEqual(home.asked(), ["models /repo", "trust /repo"]);
  home.client.dispatch({ type: "new_directory", cwd: "/repo.sort" });
  home.server(registry);
  assert.deepEqual(
    home.client.getState().view,
    { kind: "project", projectId: "p1", cwd: "/repo.sort" },
    "a directory picked on the home stays picked",
  );
  home.client.dispatch({ type: "open", page: { kind: "project", projectId: "p1" } });
  assert.deepEqual(
    home.client.getState().view,
    { kind: "project", projectId: "p1", cwd: "/repo.sort" },
    "opening the home already on screen keeps the picked directory",
  );
  home.client.dispatch({ type: "open", page: { kind: "projects" } });
  home.client.dispatch({ type: "open", page: { kind: "project", projectId: "p1" } });
  assert.deepEqual(
    home.client.getState().view,
    { kind: "project", projectId: "p1", cwd: "/repo" },
    "arriving from another page starts afresh in the newest member's folder",
  );

  const elsewhere = focusHarness({
    remembered: "/last",
    initial: { ...initialState, view: { kind: "project", projectId: "p2" } },
  });
  elsewhere.server(registry);
  assert.deepEqual(
    elsewhere.client.getState().view,
    { kind: "project", projectId: "p2" },
    "with no member in an open folder, nothing is guessed",
  );
});
