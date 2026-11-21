import assert from "node:assert/strict";
import { test } from "node:test";
import type { SendDisposition } from "../shared/transport/ws.ts";
import type { ClientCommand, ServerMessage } from "../shared/wire.ts";
import {
  correlatedRequests,
  RECEIPT_TIMEOUT_MS,
  type RequestOutcome,
} from "../web/src/shared/transport/correlatedRequest.ts";

type Result = Extract<ServerMessage, { _tag: "data_controls_result" }>["result"];

function harness() {
  let connected = true;
  let disposition: SendDisposition | "throw" = "sent";
  let onSend = () => {};
  const sent: ClientCommand[] = [];
  const stateListeners = new Set<() => void>();
  const messageListeners = new Set<(m: ServerMessage) => void>();
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let ids = 0;
  const client = {
    getState: () => ({ connected }),
    subscribe: (listener: () => void) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    listen: (listener: (m: ServerMessage) => void) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    send: (command: ClientCommand): SendDisposition => {
      sent.push(command);
      onSend();
      if (disposition === "throw") throw new Error("encode failed");
      return disposition;
    },
  };
  const requests = correlatedRequests({
    client: client as never,
    newRequestId: () => `r${++ids}`,
    timers: {
      setTimeout: (run, ms) => {
        assert.equal(ms, RECEIPT_TIMEOUT_MS);
        timers.set(++nextTimer, run);
        return nextTimer;
      },
      clearTimeout: (timer) => timers.delete(timer as number),
    },
  });
  const outcomes: RequestOutcome<Result>[] = [];
  const pending: string[] = [];
  const send = () =>
    requests.send<Result>({
      command: (requestId) => ({ _tag: "archive_all_sessions", requestId }),
      receipt: (m) => (m._tag === "data_controls_result" ? m : undefined),
      pending: (requestId) => pending.push(requestId),
      settle: (outcome) => outcomes.push(outcome),
    });
  return {
    send,
    sent,
    outcomes,
    pending,
    timers,
    receipt: (requestId: string, result: Result) => {
      for (const listener of [...messageListeners])
        listener({ _tag: "data_controls_result", requestId, result });
    },
    connection: (value: boolean) => {
      connected = value;
      for (const listener of [...stateListeners]) listener();
    },
    disposition: (value: SendDisposition | "throw") => {
      disposition = value;
    },
    duringSend: (run: () => void) => {
      onSend = run;
    },
    elapse: () => {
      for (const run of [...timers.values()]) run();
    },
    listening: () => stateListeners.size + messageListeners.size,
  };
}

test("its own receipt confirms with the result, once; other requests' receipts are ignored", () => {
  const h = harness();
  const { requestId } = h.send();
  assert.deepEqual(h.sent, [{ _tag: "archive_all_sessions", requestId: "r1" }]);
  assert.deepEqual(h.pending, ["r1"], "pending is announced with the id it sends");
  h.receipt("other", { status: "ready", count: 9 });
  assert.deepEqual(h.outcomes, []);
  h.receipt(requestId, { status: "ready", count: 3 });
  h.receipt(requestId, { status: "error", detail: "late" });
  h.connection(false);
  h.elapse();
  assert.deepEqual(h.outcomes, [{ status: "confirmed", result: { status: "ready", count: 3 } }]);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listening(), 0);
});

test("an error receipt fails with the server's detail", () => {
  const h = harness();
  h.send();
  h.receipt("r1", { status: "error", detail: "Session is not archived" });
  assert.deepEqual(h.outcomes, [
    { status: "failed", error: { status: "error", detail: "Session is not archived" } },
  ]);
  assert.equal(h.timers.size, 0);
});

test("a send that reached nothing settles at once as not sent, even if the connection drops while sending", () => {
  for (const disposition of ["not-sent", "throw"] as const) {
    const h = harness();
    h.disposition(disposition);
    h.duringSend(() => h.connection(false));
    h.send();
    assert.deepEqual(h.outcomes, [{ status: "not-sent" }], disposition);
    assert.equal(h.timers.size, 0);
    assert.equal(h.listening(), 0);
  }
});

test("losing the connection after sending leaves the outcome unconfirmed, never failed", () => {
  const h = harness();
  h.send();
  h.connection(true);
  assert.deepEqual(h.outcomes, [], "a connected update does not settle");
  h.connection(false);
  h.connection(true);
  h.receipt("r1", { status: "ready", count: 1 });
  assert.deepEqual(h.outcomes, [{ status: "unconfirmed", reason: "connection-lost" }]);
  assert.equal(h.timers.size, 0);

  const uncertain = harness();
  uncertain.disposition("uncertain");
  uncertain.duringSend(() => uncertain.connection(false));
  uncertain.send();
  assert.deepEqual(
    uncertain.outcomes,
    [{ status: "unconfirmed", reason: "connection-lost" }],
    "a send that may have reached the server is not reported as not sent",
  );
});

test("no receipt within the timeout is unconfirmed; an uncertain send waits for it", () => {
  const h = harness();
  h.disposition("uncertain");
  h.send();
  assert.deepEqual(h.outcomes, []);
  h.elapse();
  h.receipt("r1", { status: "ready", count: 1 });
  assert.deepEqual(h.outcomes, [{ status: "unconfirmed", reason: "no-receipt" }]);
  assert.equal(h.listening(), 0);
});

test("cancel settles nothing and stops listening", () => {
  const h = harness();
  const request = h.send();
  request.cancel();
  h.receipt("r1", { status: "ready", count: 1 });
  h.connection(false);
  assert.deepEqual(h.outcomes, []);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listening(), 0);
});
