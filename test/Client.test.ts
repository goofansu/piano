import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage, ServerMessage, SessionClosure } from "../shared/wire.ts";
import { createClient, type NotifyLevel } from "../web/src/lib/client.ts";
import { NEW_SESSION_DRAFT } from "../web/src/lib/messageDraft.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

/** A client over a fake transport: the test plays the server and the socket's status changes. */
function harness() {
  const sent: ClientMessage[] = [];
  const notes: Array<[string, NotifyLevel | undefined]> = [];
  let handlers: ConnectionHandlers | undefined;
  let ids = 0;
  const client = createClient({
    initial: initialState,
    connect: (h) => { handlers = h; return { send: (m) => sent.push(m), close: () => {} }; },
    notify: (message, level) => notes.push([message, level]),
    newSelectionId: () => `sel${++ids}`,
  });
  client.start();
  const server = (m: ServerMessage) => handlers!.onMessage(m);
  const status = (connected: boolean) => handlers!.onStatus(connected);
  const selects = () => sent.filter(m => m._tag === "select");
  const lastSelectionId = () => client.getState().selectionId!;
  const selected = (sessionId: string, sequence = 1, generation = "g1"): ServerMessage => ({
    _tag: "selected", cwd: "/scratch", sessionId, selectionId: lastSelectionId(), hosted: true,
    cursor: { cwd: "/scratch", sessionId, generation, sequence },
    snapshot: { state: { sessionId, isStreaming: false }, messages: [{ id: "m1", role: "user", text: "kept" }], dialogs: [] },
  });
  const event = (sequence: number, e: Extract<ServerMessage, { _tag: "session" }>["event"], selectionId = lastSelectionId()): ServerMessage => ({
    _tag: "session", selectionId, cursor: { cwd: "/scratch", sessionId: "a", generation: "g1", sequence }, event: e,
  });
  return { client, sent, notes, server, status, selects, selected, event };
}

const act = { _tag: "act", action: { _tag: "abort" } } as const;

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
  assert.deepEqual(h.selects().map(m => [m.sessionId, m.selectionId]), [["a", "sel1"], ["a", "sel2"]]);
  assert.deepEqual(h.client.getState().session?.messages.map(m => m.text), ["kept"], "the view is retained while re-attaching");
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
  assert.equal(h.sent.filter(m => m._tag === "act").length, 0, "no act before the selection's snapshot");
  h.server(h.selected("a"));
  h.client.send(act);
  assert.deepEqual(h.sent.filter(m => m._tag === "act").map(m => m.selectionId), ["sel1"]);

  h.status(false);
  h.client.send(act);
  h.status(true);
  h.client.send(act);
  assert.equal(h.sent.filter(m => m._tag === "act").length, 1, "no act on a lost or re-selecting attachment");
  h.server(h.selected("a"));
  h.client.send(act);
  assert.deepEqual(h.sent.filter(m => m._tag === "act").map(m => m.selectionId), ["sel1", "sel2"]);
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
  assert.deepEqual(h.notes, [["applied", "warning"], ["server toast", "info"], ["boom", "error"]]);
});

test("INV-02: a closure notifies by its kind, never by its wording", () => {
  const cases: Array<[SessionClosure, boolean]> = [
    [{ _tag: "released", detail: "Pi was released" }, false],
    [{ _tag: "exited", code: 0, detail: "Pi exited with code 0" }, false],
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
    assert.deepEqual(h.notes, notifies ? [[`Pi stopped: ${closure.detail}`, "warning"]] : [], closure._tag);
    assert.equal(h.client.getState().session?.state.closure, closure);
  }
});

test("create_session mints a selection and shows the first message until Pi records it", () => {
  const h = harness();
  h.status(true);
  h.client.send({ _tag: "create_session", cwd: "/scratch", options: {}, text: "hello" });
  const created = h.sent.find(m => m._tag === "create_session");
  assert.equal(created?.selectionId, "sel1");
  assert.equal(h.client.getState().pendingCreate?.text, "hello");
  assert.equal(h.client.getState().view.kind, "session");
});

/** What the client asked Pi about, as `tag cwd` pairs, since the last call. */
function focusHarness(options: { remembered?: string | null; initial?: typeof initialState } = {}) {
  const sent: ClientMessage[] = [];
  const written: string[] = [];
  let handlers: ConnectionHandlers | undefined;
  let ids = 0;
  const client = createClient({
    initial: options.initial ?? initialState,
    connect: (h) => { handlers = h; return { send: (m) => sent.push(m), close: () => {} }; },
    notify: () => {},
    newSelectionId: () => `sel${++ids}`,
    lastDirectory: { read: () => options.remembered ?? null, write: (cwd) => written.push(cwd) },
  });
  client.start();
  let seen = 0;
  const asked = () => {
    const out = sent.slice(seen).filter(m => m._tag === "models" || m._tag === "trust").map(m => `${m._tag} ${m.cwd}`);
    seen = sent.length;
    return out;
  };
  const server = (m: ServerMessage) => handlers!.onMessage(m);
  const status = (connected: boolean) => handlers!.onStatus(connected);
  const folder = (path: string) => ({ path, name: path.slice(1), worktrees: [], discovery: { status: "ready", observedAt: "", currentPath: path, worktrees: [] } }) as never;
  const selected = (cwd: string, checkoutMissing = false): ServerMessage => ({
    _tag: "selected", cwd, sessionId: "s", selectionId: client.getState().selectionId!, hosted: false,
    cursor: { cwd, sessionId: "s", generation: "g1", sequence: 1 },
    snapshot: { state: { sessionId: "s", isStreaming: false, checkoutMissing }, messages: [], dialogs: [] },
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
  h.client.dispatch({ type: "new", projectId: "p1" });
  assert.deepEqual(h.client.getState().view, { kind: "new", cwd: "/a", projectId: "p1" }, "picking a project keeps the directory");
  h.client.dispatch({ type: "draft_changed", key: NEW_SESSION_DRAFT, text: "typing" });
  assert.deepEqual(h.asked(), [], "the same directory is not asked about again");
  h.client.dispatch({ type: "new_directory", cwd: "/b" });
  assert.deepEqual(h.asked(), ["models /b", "trust /b"]);
});

test("INV-05: catalogs_invalidated and reconnect re-ask only for the focused directory", () => {
  const h = focusHarness();
  h.status(true);
  h.client.dispatch({ type: "new_directory", cwd: "/a" });
  h.client.select("/b", "s");
  h.server(h.selected("/b"));
  assert.deepEqual(h.asked(), ["models /a", "trust /a", "models /b", "trust /b"], "the selected session becomes the focus");
  h.server({ _tag: "catalogs_invalidated" });
  assert.deepEqual(h.asked(), ["models /b", "trust /b"]);
  h.status(false);
  assert.deepEqual(h.asked(), [], "nothing is sent while disconnected");
  h.status(true);
  assert.deepEqual(h.asked(), ["models /b", "trust /b"], "a reconnect asks once for the session still on screen");
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

  const project = focusHarness({ remembered: "/last", initial: { ...initialState, view: { kind: "new", projectId: "p1" } } });
  assert.deepEqual(project.client.getState().view, { kind: "new", projectId: "p1" }, "a project's home starts without a directory");
});
