import assert from "node:assert/strict";
import { test } from "node:test";
import type { HostInfo, ServerMessage, SessionReference, StoppedSession } from "../shared/wire.ts";
import { sessionKey } from "../shared/wire.ts";
import { createInbox, inboxList } from "../web/src/lib/inbox.ts";
import { LOCAL, type Machine } from "../web/src/lib/machine.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";

const ENG1: Machine = { id: "eng-1", name: "eng-1" };
const ENG2: Machine = { id: "eng-2", name: "eng-2" };
const cwd = "/repo";

const reference = (sessionId: string, title: string, more = {}): SessionReference => ({
  cwd,
  sessionId,
  title,
  workspaceId: "w1",
  branch: "main",
  archived: false,
  createdAt: "2026-11-13T00:00:00.000Z",
  updatedAt: "2026-11-13T01:00:00.000Z",
  ...more,
});
const registry = (...sessionReferences: SessionReference[]): ServerMessage => ({
  _tag: "registry",
  folders: [{ path: cwd, name: "repo", worktrees: [] } as never],
  projects: [],
  sessionReferences,
  workspaces: [],
});
const hosts = (list: HostInfo[], stopped: StoppedSession[] = []): ServerMessage => ({
  _tag: "hosts",
  hosts: list,
  stopped,
});
const host = (sessionId: string, more: Partial<HostInfo> = {}): HostInfo => ({
  cwd,
  sessionId,
  working: false,
  ...more,
});

/** An Inbox whose connections the test drives: what each machine says, and whether it is closed. */
function inboxOf(machines: Machine[]) {
  const handlers = new Map<string, ConnectionHandlers>();
  const closed: string[] = [];
  let time = Date.parse("2026-11-13T02:00:00.000Z");
  const inbox = createInbox({
    connect: (id, h) => {
      handlers.set(id, h);
      return { send: () => "not-sent", close: () => closed.push(id) };
    },
    now: () => new Date(time++).toISOString(),
  });
  inbox.setMachines(machines);
  const says = (id: string, ...messages: ServerMessage[]) => {
    handlers.get(id)!.onStatus(true);
    for (const message of messages) handlers.get(id)!.onMessage(message);
  };
  const rows = () => {
    const list = inboxList(inbox.getState());
    const row = (i: (typeof list.attention)[number]) => `${i.machine.name}/${i.label}: ${i.kind}`;
    return { attention: list.attention.map(row), working: list.working.map(row) };
  };
  return { inbox, says, rows, handlers, closed };
}

test("lists the sessions that need the person from every machine, and the ones at work beneath", () => {
  const { says, rows } = inboxOf([LOCAL, ENG1, ENG2]);
  says(
    LOCAL.id,
    registry(reference("a", "Local idle"), reference("b", "Local busy")),
    hosts([host("a"), host("b", { working: true })]),
  );
  says(
    ENG1.id,
    registry(reference("a", "Asks")),
    // A session waiting on a dialog is still at work for Pi; it needs the person first.
    hosts([host("a", { working: true, needsInput: true })]),
  );
  says(
    ENG2.id,
    registry(reference("a", "Crashed"), reference("b", "Never ran")),
    hosts([], [{ cwd, sessionId: "a", detail: "exit 3", at: "2026-11-13T01:30:00.000Z" }]),
  );
  assert.deepEqual(rows(), {
    attention: ["eng-2/Crashed: failed", "eng-1/Asks: needs_input"],
    working: ["Local/Local busy: working"],
  });
});

test("the same directory and session ID on two machines are two sessions", () => {
  const { says, rows } = inboxOf([LOCAL, ENG1]);
  says(LOCAL.id, registry(reference("a", "Mine")), hosts([host("a", { working: true })]));
  says(ENG1.id, registry(reference("a", "Theirs")), hosts([host("a", { needsInput: true })]));
  assert.deepEqual(rows(), {
    attention: ["eng-1/Theirs: needs_input"],
    working: ["Local/Mine: working"],
  });
});

test("a turn that finishes off screen is done until its session is opened", () => {
  const { inbox, says, rows } = inboxOf([LOCAL, ENG1]);
  says(ENG1.id, registry(reference("a", "Task")), hosts([host("a", { working: true })]));
  says(ENG1.id, hosts([host("a")]));
  assert.deepEqual(rows().attention, ["eng-1/Task: done"]);
  // Another machine showing a session with the same key answers nothing here.
  inbox.viewing(LOCAL.id, sessionKey(cwd, "a"));
  assert.deepEqual(rows().attention, ["eng-1/Task: done"]);
  inbox.viewing(ENG1.id, sessionKey(cwd, "a"));
  assert.deepEqual(rows().attention, []);
});

test("a turn that finishes on screen is not listed", () => {
  const { inbox, says, rows } = inboxOf([LOCAL, ENG1]);
  inbox.viewing(ENG1.id, sessionKey(cwd, "a"));
  says(ENG1.id, registry(reference("a", "Task")), hosts([host("a", { working: true })]));
  says(ENG1.id, hosts([host("a")]));
  assert.deepEqual(rows().attention, []);
});

test("a stop is listed until its session is opened, and a later stop is listed again", () => {
  const { inbox, says, rows } = inboxOf([LOCAL, ENG1]);
  const stop = (at: string) => [{ cwd, sessionId: "a", detail: "exit 3", at }];
  says(ENG1.id, registry(reference("a", "Task")), hosts([], stop("2026-11-13T01:30:00.000Z")));
  assert.deepEqual(rows().attention, ["eng-1/Task: failed"]);
  inbox.viewing(ENG1.id, sessionKey(cwd, "a"));
  inbox.viewing(ENG1.id, null);
  assert.deepEqual(rows().attention, []);
  says(ENG1.id, hosts([], stop("2026-11-13T01:45:00.000Z")));
  assert.deepEqual(rows().attention, ["eng-1/Task: failed"]);
});

test("opening a row answers it even when its session cannot be shown", () => {
  const { inbox, says, rows } = inboxOf([LOCAL, ENG1]);
  says(
    ENG1.id,
    registry(reference("a", "Lost", { unavailable: "history" })),
    hosts([], [{ cwd, sessionId: "a", detail: "exit 3", at: "2026-11-13T01:30:00.000Z" }]),
  );
  assert.deepEqual(rows().attention, ["eng-1/Lost: failed"]);
  inbox.seen(ENG1.id, sessionKey(cwd, "a"));
  assert.deepEqual(rows().attention, []);
});

test("archived sessions and sessions the machine no longer lists are left out", () => {
  const { says, rows } = inboxOf([LOCAL, ENG1]);
  says(
    ENG1.id,
    registry(reference("a", "Archived", { archived: true })),
    hosts([host("a", { needsInput: true }), host("gone", { needsInput: true })]),
  );
  assert.deepEqual(rows(), { attention: [], working: [] });
});

test("a machine whose connection is down is named, and keeps what it last said", () => {
  const { inbox, says, rows, handlers } = inboxOf([LOCAL, ENG1]);
  says(ENG1.id, registry(reference("a", "Asks")), hosts([host("a", { needsInput: true })]));
  assert.deepEqual(inboxList(inbox.getState()).unavailable, []);
  handlers.get(ENG1.id)!.onStatus(false);
  assert.deepEqual(inboxList(inbox.getState()).unavailable, [ENG1]);
  assert.deepEqual(rows().attention, ["eng-1/Asks: needs_input"]);
  handlers.get(ENG1.id)!.onStatus(true);
  assert.deepEqual(inboxList(inbox.getState()).unavailable, []);
});

test("one machine alone is not observed; a machine removed from the list is disconnected", () => {
  const alone = inboxOf([LOCAL]);
  assert.equal(alone.handlers.size, 0);
  assert.equal(inboxList(alone.inbox.getState()).loading, false);

  const { inbox, says, rows, closed } = inboxOf([LOCAL, ENG1, ENG2]);
  says(ENG2.id, registry(reference("a", "Asks")), hosts([host("a", { needsInput: true })]));
  assert.equal(inboxList(inbox.getState()).loading, false);
  inbox.setMachines([LOCAL, ENG1]);
  assert.deepEqual(closed, [ENG2.id]);
  assert.deepEqual(rows().attention, []);
});
