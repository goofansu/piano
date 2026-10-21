import assert from "node:assert/strict";
import { test } from "node:test";
import { type ClientMessage, encodeServerMessage } from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import { messageCommand, newSessionCommand } from "../web/src/lib/composerControl.ts";
import { createDrafts, NEW_SESSION_DRAFT, sessionDraftKey } from "../web/src/lib/messageDraft.ts";
import { emptyChoice, type ModelTarget, modelChoice } from "../web/src/lib/modelChoice.ts";
import { openConnection, type SocketEnvironment, type SocketEvents } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

/** Real transport and client; only the external socket and reconnect clock are controlled. */
function harness({ select = true } = {}) {
  const sockets: Array<{
    events: SocketEvents;
    open: boolean;
    sent: ClientMessage[];
    throws: boolean;
  }> = [];
  let online = () => {};
  const env: SocketEnvironment = {
    open: (_url, events) => {
      const socket = { events, open: false, sent: [] as ClientMessage[], throws: false };
      sockets.push(socket);
      return {
        isOpen: () => socket.open,
        send: (data) => {
          socket.sent.push(JSON.parse(data));
          if (socket.throws) throw new Error("Delivery outcome unknown");
        },
        close: () => {
          socket.open = false;
        },
      };
    },
    url: () => "ws://scratch.test/ws",
    nonce: () => "ping",
    setTimeout: () => 0,
    clearTimeout: () => {},
    onOnline: (listener) => {
      online = listener;
      return () => {};
    },
    onOffline: () => () => {},
  };
  let ids = 0;
  const notices: string[] = [];
  const client = createClient({
    initial: initialState,
    connect: (handlers) => openConnection(handlers, env),
    notify: (message) => notices.push(message),
    newSelectionId: () => `selection-${++ids}`,
    lastDirectory: { read: () => null, write: () => {} },
  });
  const stop = client.start();
  const last = () => sockets.at(-1)!;
  const accept = () => {
    last().open = true;
    last().events.open();
  };
  const selected = () =>
    last().events.message(
      encodeServerMessage(
        {
          _tag: "selected",
          cwd: "/scratch",
          sessionId: "existing",
          selectionId: client.getState().selectionId!,
          hosted: true,
          cursor: { cwd: "/scratch", sessionId: "existing", generation: "g1", sequence: 1 },
          snapshot: {
            state: { sessionId: "existing", isStreaming: false },
            messages: [],
            dialogs: [],
          },
        },
        1,
      ),
    );
  accept();
  if (select) {
    client.select("/scratch", "existing");
    selected();
  }
  return {
    client,
    stop,
    last,
    accept,
    selected,
    notices,
    reconnect: () => online(),
    actions: () => sockets.flatMap((s) => s.sent).filter((m) => m._tag === "act"),
    creations: () => sockets.flatMap((s) => s.sent).filter((m) => m._tag === "create_session"),
  };
}

test("PIN-61: CLOSING before onclose retains the full draft for explicit retry after selection", async (t) => {
  const h = harness();
  t.after(h.stop);
  const drafts = createDrafts();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "existing" });
  drafts.setText(key, "Keep my draft");
  drafts.addQuote(key, "Quoted context");
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  await drafts.addImages(key, [new File([bytes], "shot.png", { type: "image/png" })], async () =>
    Buffer.from(bytes).toString("base64"),
  );
  const before = drafts.get(key);
  const target: ModelTarget = {
    kind: "session",
    cwd: "/scratch",
    sessionId: "existing",
    hosted: true,
  };
  const pick = modelChoice(emptyChoice(target), null, target, false).chooseModel("test/held");
  assert.equal(pick.kind, "hold");
  let held = pick.held;
  const submit = () => {
    let consumed = false;
    held = modelChoice(held, null, target).submit((start) => {
      consumed = drafts.submit(key, (message) =>
        h.client.send(messageCommand("steering", message, start)),
      );
      return consumed;
    });
    return consumed;
  };

  h.last().open = false; // CLOSING, but no onclose callback yet.
  assert.equal(h.client.getState().connected, true);
  assert.equal(submit(), false, "known-unsent must not report composer success");
  assert.equal(h.actions().length, 0);
  assert.deepEqual(drafts.get(key), before);
  assert.deepEqual(held.pick, { model: "test/held" });
  assert.match(h.notices[0]!, /Message not sent.*retry/);
  assert.equal(h.client.getState().connected, false);

  h.reconnect();
  h.accept();
  assert.equal(submit(), false, "wait for authoritative selection before retry");
  assert.deepEqual(drafts.get(key), before);
  h.selected();
  assert.equal(h.actions().length, 0, "reconnect does not replay");
  assert.equal(submit(), true);
  assert.equal(h.actions().length, 1);
  assert.deepEqual(h.actions()[0]!.start, { model: "test/held" });
  assert.deepEqual(h.actions()[0]!.action, {
    _tag: "steer",
    text: "> Quoted context\n\nKeep my draft",
    attachments: before.images.items,
  });
  assert.deepEqual(held.pick, {});
  assert.equal(drafts.sendable(key), false);
  h.last().events.close(1006);
  h.reconnect();
  h.accept();
  h.selected();
  assert.equal(h.actions().length, 1, "accepted sends are never replayed");
});

test("PIN-61: a throwing send is uncertain and reconnect never replays it", (t) => {
  const h = harness();
  t.after(h.stop);
  const drafts = createDrafts();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "existing" });
  drafts.setText(key, "Possibly delivered");
  h.last().throws = true;
  assert.equal(
    drafts.submit(key, (message) => {
      const disposition = h.client.send(messageCommand("follow-up", message, {}));
      assert.equal(disposition, "uncertain");
      return disposition;
    }),
    true,
  );
  assert.equal(drafts.sendable(key), false);
  assert.match(h.notices[0]!, /delivery is uncertain/);
  h.reconnect();
  h.accept();
  h.selected();
  assert.equal(h.actions().length, 1);
});

test("a new session's first message that is known not sent stays on the New page as a draft", (t) => {
  const h = harness({ select: false });
  t.after(h.stop);
  h.client.dispatch({ type: "new_directory", cwd: "/scratch" });
  const drafts = createDrafts();
  drafts.setText(NEW_SESSION_DRAFT, "Start here");
  const before = drafts.get(NEW_SESSION_DRAFT);
  const target: ModelTarget = { kind: "new", cwd: "/scratch" };
  const pick = modelChoice(emptyChoice(target), null, target).chooseModel("test/held");
  assert.equal(pick.kind, "hold");
  let held = pick.held;
  const submit = () => {
    let consumed = false;
    held = modelChoice(held, null, target).submit((start) => {
      consumed = drafts.submit(NEW_SESSION_DRAFT, (message) =>
        h.client.send(newSessionCommand({ cwd: "/scratch", projectId: undefined }, message, start)),
      );
      return consumed;
    });
    return consumed;
  };

  h.last().open = false; // CLOSING, but no onclose callback yet.
  assert.equal(submit(), false, "known-unsent must not consume the draft");
  assert.equal(h.creations().length, 0);
  assert.deepEqual(drafts.get(NEW_SESSION_DRAFT), before);
  assert.deepEqual(h.client.getState().view, { kind: "new", cwd: "/scratch" });
  assert.equal(
    h.client.getState().pendingCreate,
    null,
    "nothing was sent, so nothing is uncertain",
  );
  assert.equal(h.client.getState().selecting, null);
  assert.match(h.notices[0] ?? "", /Message not sent.*retry/);
  assert.deepEqual(held.pick, { model: "test/held" });

  h.reconnect();
  h.accept();
  assert.equal(h.creations().length, 0, "reconnect does not replay the creation");
  assert.equal(submit(), true);
  assert.equal(h.creations().length, 1);
  assert.equal(h.creations()[0]!.options.model, "test/held");
  assert.deepEqual(held.pick, {});
  assert.equal(h.client.getState().view.kind, "session");
  assert.equal(h.client.getState().pendingCreate?.text, "Start here");
  assert.equal(h.client.getState().pendingCreate?.outcome, "starting");
  assert.equal(drafts.sendable(NEW_SESSION_DRAFT), false);
});

test("a new session's first message whose send throws opens the session as uncertain and never replays", (t) => {
  const h = harness({ select: false });
  t.after(h.stop);
  const drafts = createDrafts();
  drafts.setText(NEW_SESSION_DRAFT, "Possibly started");
  h.last().throws = true;
  assert.equal(
    drafts.submit(NEW_SESSION_DRAFT, (message) =>
      h.client.send(newSessionCommand({ cwd: "/scratch", projectId: undefined }, message, {})),
    ),
    true,
  );
  assert.equal(drafts.sendable(NEW_SESSION_DRAFT), false);
  assert.equal(h.client.getState().view.kind, "session");
  assert.equal(h.client.getState().pendingCreate?.text, "Possibly started");
  assert.equal(h.client.getState().pendingCreate?.outcome, "uncertain");
  h.reconnect();
  h.accept();
  assert.equal(h.creations().length, 1, "reconnect never replays the creation");
});
