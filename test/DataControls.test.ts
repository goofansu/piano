import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage, ServerMessage } from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import { RECEIPT_TIMEOUT_MS } from "../web/src/lib/correlatedRequest.ts";
import { archiveConfirmation, createDataControls } from "../web/src/lib/dataControls.ts";
import { LOCAL } from "../web/src/lib/machine.ts";
import { machineOffers } from "../web/src/lib/machineOffers.ts";
import type { ConnectionHandlers, SendDisposition } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

function page() {
  const sent: ClientMessage[] = [];
  const notices: string[] = [];
  const levels: (string | undefined)[] = [];
  let handlers!: ConnectionHandlers;
  let disposition: SendDisposition = "sent";
  const client = createClient({
    startsSessionIn: machineOffers(LOCAL).startsSessionIn,
    initial: initialState,
    connect: (h) => {
      handlers = h;
      return {
        send: (message) => {
          sent.push(message);
          return disposition;
        },
        close: () => {},
      };
    },
    notify: (message) => {
      notices.push(message);
    },
    lastDirectory: { read: () => null, write: () => {} },
  });
  const stopClient = client.start();
  handlers.onStatus(true);
  let nextId = 0;
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const controls = createDataControls({
    client,
    newRequestId: () => `r${++nextId}`,
    notify: (message, level) => {
      notices.push(message);
      levels.push(level);
    },
    timers: {
      setTimeout: (run, ms) => {
        assert.equal(ms, RECEIPT_TIMEOUT_MS);
        timers.set(++nextTimer, run);
        return nextTimer;
      },
      clearTimeout: (timer) => {
        timers.delete(timer as number);
      },
    },
  });
  const stop = controls.start();
  const result = (
    requestId: string,
    result: Extract<ServerMessage, { _tag: "data_controls_result" }>["result"],
  ) => handlers.onMessage({ _tag: "data_controls_result", requestId, result });
  return {
    controls,
    notices,
    levels,
    timers,
    result,
    state: controls.getState,
    commands: () =>
      sent.filter((m) =>
        ["archive_sessions_count", "archive_all_sessions", "unarchive_session"].includes(m._tag),
      ),
    view: () => archiveConfirmation(controls.getState(), client.getState().connected),
    connection: handlers.onStatus,
    server: handlers.onMessage,
    disposition: (value: SendDisposition) => {
      disposition = value;
    },
    elapse: () => {
      for (const run of [...timers.values()]) run();
    },
    stop: () => {
      stop();
      stopClient();
    },
  };
}

test("Archive all reads a fresh authoritative count before offering confirmation; zero cannot submit", () => {
  const p = page();
  p.controls.archive();
  assert.deepEqual(p.commands(), []);
  p.controls.open();
  assert.deepEqual(p.commands(), [{ _tag: "archive_sessions_count", requestId: "r1" }]);
  assert.equal(p.view().open, false, "no estimated count is presented as the confirmation");
  p.controls.open();
  p.controls.archive();
  assert.equal(p.commands().length, 1);
  p.result("unrelated", { status: "ready", count: 99 });
  assert.equal(p.state().request?.kind, "count");
  p.result("r1", { status: "ready", count: 0 });
  assert.deepEqual(p.view(), {
    open: true,
    title: "Archive 0 sessions?",
    busy: false,
    disabled: true,
  });
  p.controls.archive();
  assert.equal(p.commands().length, 1);
  p.controls.cancel();
  p.controls.open();
  p.result("r2", { status: "ready", count: 3 });
  assert.deepEqual(p.view(), {
    open: true,
    title: "Archive 3 sessions?",
    busy: false,
    disabled: false,
  });
  assert.deepEqual(p.notices, [], "a read does not toast");
  p.stop();
});

test("bulk archive sends once, waits for its receipt, and leaves actual success feedback to the server", () => {
  const p = page();
  p.controls.open();
  p.result("r1", { status: "ready", count: 8 });
  p.controls.archive();
  assert.deepEqual(p.commands().at(-1), { _tag: "archive_all_sessions", requestId: "r2" });
  assert.equal(p.view().busy, true);
  p.controls.archive();
  p.controls.cancel();
  assert.equal(p.commands().length, 2);
  assert.equal(p.view().open, true);
  p.result("r1", { status: "ready", count: 0 });
  assert.equal(p.view().busy, true, "the earlier count cannot settle the mutation");
  p.result("r2", { status: "ready", count: 5 });
  assert.equal(p.view().open, false);
  assert.equal(p.timers.size, 0);
  assert.deepEqual(p.notices, []);
  p.server({ _tag: "toast", message: "5 sessions archived", level: "success" });
  assert.deepEqual(
    p.notices,
    ["5 sessions archived"],
    "the observed result may differ from the confirmation count",
  );
  p.stop();
});

test("unarchive preserves the target directory and does not reopen a closed folder or invent a success toast", () => {
  const p = page();
  p.controls.unarchive({ cwd: "/closed/folder", sessionId: "s1" });
  assert.deepEqual(p.commands(), [
    { _tag: "unarchive_session", cwd: "/closed/folder", sessionId: "s1", requestId: "r1" },
  ]);
  p.controls.unarchive({ cwd: "/other", sessionId: "s2" });
  assert.equal(p.commands().length, 1);
  p.result("r1", { status: "ready", count: 1 });
  assert.equal(p.state().request, undefined);
  assert.deepEqual(p.notices, []);
  const message = "Session unarchived; folder remains closed";
  p.server({ _tag: "toast", message, level: "success" });
  assert.deepEqual(
    p.notices,
    [message],
    "the server supplies truthful closed-folder wording unchanged",
  );
  p.stop();
});

test("mutation failures show the server's detail once, ignoring duplicate and late receipts", () => {
  const p = page();
  p.controls.unarchive({ cwd: "/repo", sessionId: "s1" });
  p.result("r1", { status: "error", detail: "Session is not archived" });
  p.result("r1", { status: "error", detail: "duplicate" });
  p.controls.open();
  p.result("r2", { status: "ready", count: 4 });
  p.controls.archive();
  p.result("r3", { status: "error", detail: "Client input capacity is full." });
  p.result("r3", { status: "ready", count: 4 });
  assert.deepEqual(p.notices, [
    "Could not unarchive session: Session is not archived",
    "Could not archive sessions: Client input capacity is full.",
  ]);
  assert.deepEqual(p.levels, ["error", "error"]);
  assert.equal(p.state().request, undefined);
  assert.equal(p.view().open, false);
  p.stop();
});

test("count failure is a retryable read state without a toast", () => {
  const p = page();
  p.controls.open();
  p.result("r1", { status: "error", detail: "unavailable" });
  assert.equal(p.state().countFailed, true);
  assert.equal(p.view().open, false);
  assert.deepEqual(p.notices, []);
  p.controls.open();
  p.result("r2", { status: "ready", count: 2 });
  assert.equal(p.state().countFailed, false);
  assert.equal(p.view().disabled, false);
  p.stop();
});

test("disconnect clears busy and stale counts; reconnect never replays a mutation or opens confirmation", () => {
  const p = page();
  p.controls.open();
  p.result("r1", { status: "ready", count: 4 });
  p.connection(false);
  assert.equal(p.view().open, false);
  p.connection(true);
  assert.equal(p.commands().length, 1);
  p.controls.unarchive({ cwd: "/repo", sessionId: "s1" });
  p.connection(false);
  assert.equal(p.state().request, undefined);
  p.connection(true);
  assert.equal(p.commands().length, 2);
  p.result("r2", { status: "ready", count: 1 });
  assert.deepEqual(
    p.notices,
    ["Connection lost. Unarchive may have finished; check Archived sessions after reconnecting."],
    "the server keeps running the mutation after a disconnect, so it is not reported as failed",
  );
  assert.deepEqual(p.levels, ["warning"]);
  assert.equal(p.timers.size, 0);
  p.stop();
});

test("timeout, not-sent and uncertain sends settle without replay; unmount fences late receipts", () => {
  const p = page();
  p.disposition("not-sent");
  p.controls.unarchive({ cwd: "/repo", sessionId: "s1" });
  assert.equal(p.state().request, undefined);
  p.disposition("uncertain");
  p.controls.unarchive({ cwd: "/repo", sessionId: "s1" });
  assert.equal(p.state().request?.kind, "unarchive");
  p.elapse();
  assert.equal(p.state().request, undefined);
  assert.equal(p.commands().length, 2);
  assert.deepEqual(p.notices, [
    "Could not unarchive session",
    "No reply. Unarchive may have finished; check Archived sessions.",
  ]);
  assert.deepEqual(p.levels, ["error", "warning"]);
  p.disposition("sent");
  p.controls.open();
  p.stop();
  assert.equal(p.timers.size, 0);
  p.result("r3", { status: "ready", count: 9 });
  assert.equal(p.view().open, false);
});
