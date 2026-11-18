import assert from "node:assert/strict";
import { test } from "node:test";
import { PiProjector } from "../server/PiRecords.ts";

const projector = () => new PiProjector({ generation: "g1" });

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

test("a dialog request is constructed once per id with Pi's timeout and receipt time", () => {
  const pi = projector();
  const timed = pi.record(
    { type: "extension_ui_request", id: "d1", method: "input", title: "Name", timeout: 5_000 },
    1_000,
  );
  assert.deepEqual(timed, {
    events: [],
    refresh: [],
    dialog: {
      id: "d1",
      generation: "g1",
      receivedAt: 1_000,
      timeoutMs: 5_000,
      method: "input",
      title: "Name",
      message: undefined,
      options: undefined,
      placeholder: undefined,
      prefill: undefined,
    },
  });
  assert.deepEqual(pi.record({ type: "extension_ui_request", id: "d1", method: "input" }, 2_000), {
    events: [],
    refresh: [],
  });
  const unusable = pi.record(
    { type: "extension_ui_request", id: "d2", method: "confirm", timeout: -1 },
    1_000,
  );
  assert.equal(unusable.dialog?.timeoutMs, undefined, "an unusable Pi timeout is no timeout");
});

test("INV-01/11: transcript tool args and JSON results retain their original values", () => {
  const args = { command: 'export API_KEY="hunter2longvalue"' };
  const result = JSON.stringify({ status: "answered", answers: { q: 'use token: "abc123"' } });
  const end = projector().record(
    {
      type: "tool_execution_end",
      toolCallId: "a",
      toolName: "bash",
      args,
      result: { content: [{ type: "text", text: result }] },
    },
    0,
  ).events[0];
  assert.equal(end?._tag, "tool_update");
  const tool = (end as Extract<typeof end, { _tag: "tool_update" }>).tool;
  assert.deepEqual(JSON.parse(tool.args), args);
  assert.equal(tool.text, result);
  const [call, saved] = projector().history([
    { role: "assistant", content: [{ type: "toolCall", id: "a", name: "bash", arguments: args }] },
    {
      role: "toolResult",
      toolCallId: "a",
      toolName: "bash",
      content: [{ type: "text", text: result }],
    },
  ]);
  assert.deepEqual(JSON.parse(call.toolCalls![0].args), args);
  assert.equal(saved.text, result);
});

test("transcript rows strip terminal control sequences, including ones a strip reassembles", () => {
  const nested = "\u001b[\u001b[31m31mred\u001b[0m";
  const pi = projector();
  const events = [
    { type: "message_start", message: { role: "assistant", content: [] } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `say ${nested}` },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 1,
        toolCall: { id: "t", name: "bash", arguments: { command: `echo ${nested}` } },
      },
    },
    { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: { command: nested } },
    {
      type: "tool_execution_update",
      toolCallId: "t",
      partialResult: { content: [{ type: "text", text: `out ${nested}` }] },
    },
    {
      type: "tool_execution_end",
      toolCallId: "t",
      result: { content: [{ type: "text", text: `done ${nested}` }] },
    },
    {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: `final ${nested}` }] },
    },
  ].flatMap((raw) => pi.record(raw, 0).events);
  const texts: string[] = [];
  JSON.stringify(events, (_, value) => (typeof value === "string" && texts.push(value), value));
  assert.deepEqual(
    texts.filter((text) => text.includes("\u001b")),
    [],
  );
  for (const text of ["say red", "out red", "done red", "final red"])
    assert.ok(texts.includes(text));
});
