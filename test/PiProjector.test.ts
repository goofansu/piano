import assert from "node:assert/strict";
import { test } from "node:test";
import { PiProjector } from "../server/PiRecords.ts";

const projector = () => new PiProjector({ generation: "g1", recoveryMs: 60_000 });

test("INV-03: overlapping turn and summary retries stay retrying until both finish", () => {
  const pi = projector();
  assert.deepEqual(
    pi.record(
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "overloaded" },
      0,
    ).state,
    { isStreaming: true, isRetrying: true },
  );
  assert.deepEqual(
    pi.record(
      { type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 2, errorMessage: "x" },
      0,
    ).state,
    { isRetrying: true },
  );
  assert.deepEqual(pi.record({ type: "auto_retry_end" }, 0).state, { isRetrying: true });
  assert.deepEqual(pi.record({ type: "summarization_retry_finished" }, 0).state, {
    isRetrying: false,
  });
  // Settling clears both, so a later lone end cannot revive a stale flag.
  pi.record({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "e" }, 0);
  const settled = pi.record({ type: "agent_settled" }, 0);
  assert.deepEqual(settled.state, { isStreaming: false, isCompacting: false, isRetrying: false });
  assert.deepEqual(settled.refresh, ["context", "state", "stats"]);
  assert.deepEqual(pi.record({ type: "summarization_retry_finished" }, 0).state, {
    isRetrying: false,
  });
});

test("INV-03: compaction is distinguishable and its end makes context and usage readbacks due", () => {
  const pi = projector();
  const start = pi.record({ type: "compaction_start", reason: "threshold" }, 0);
  assert.deepEqual(start.state, { isCompacting: true });
  assert.deepEqual(start.events, [
    { _tag: "notice", level: "info", message: "Compacting context (threshold)" },
  ]);
  const end = pi.record({ type: "compaction_end" }, 0);
  assert.deepEqual(end.state, { isCompacting: false });
  assert.deepEqual(end.refresh, ["context", "stats"]);
});

test("closed() marks only still-running tools incomplete and drops nothing else", () => {
  const pi = projector();
  pi.record(
    {
      type: "tool_execution_start",
      toolCallId: "a",
      toolName: "bash",
      args: { command: "sleep 9" },
    },
    0,
  );
  pi.record(
    { type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: { command: "true" } },
    0,
  );
  pi.record(
    {
      type: "tool_execution_end",
      toolCallId: "b",
      toolName: "bash",
      result: { content: [{ type: "text", text: "ok" }] },
    },
    0,
  );
  const events = pi.closed();
  assert.deepEqual(
    events.map((e) => (e._tag === "tool_update" ? [e.tool.id, e.tool.status] : e._tag)),
    [["a", "incomplete"]],
  );
  assert.deepEqual(pi.closed(), []);
});

test("a dialog is constructed once per id with the earlier of Pi's timeout and host recovery", () => {
  const pi = projector();
  const timed = pi.record(
    { type: "extension_ui_request", id: "d1", method: "input", title: "Name", timeout: 5_000 },
    1_000,
  );
  assert.equal(timed.dialog?.deadlineKind, "pi-timeout");
  assert.equal(timed.dialog?.deadlineAt, 6_000);
  assert.equal(timed.dialog?.generation, "g1");
  assert.deepEqual(timed.events, [{ _tag: "dialog", dialog: timed.dialog }]);
  assert.deepEqual(pi.record({ type: "extension_ui_request", id: "d1", method: "input" }, 2_000), {
    events: [],
    refresh: [],
  });
  const untimed = pi.record(
    { type: "extension_ui_request", id: "d2", method: "confirm", timeout: 120_000 },
    1_000,
  );
  assert.equal(untimed.dialog?.deadlineKind, "host-recovery");
  assert.equal(untimed.dialog?.deadlineAt, 61_000);
});
