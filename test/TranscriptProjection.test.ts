import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg, ToolExecution } from "../shared/wire.ts";
import { createTranscriptProjector, jumpEntries } from "../web/src/lib/transcript.ts";

const user: RenderMsg = { id: "user", role: "user", text: "Inspect the files" };
const call: RenderMsg = {
  id: "call",
  role: "assistant",
  text: "Inspecting",
  toolCalls: [{ id: "read", name: "read", args: '{"path":"first.ts"}' }],
};
const result: RenderMsg = {
  id: "result",
  role: "tool_result",
  toolCallId: "read",
  text: "First file",
};
const pending: RenderMsg = { id: "pending", role: "assistant", text: "Answer ![Image](plot.png)" };

test("pending-only projection keeps history objects while updating text, calls and errors", () => {
  const project = createTranscriptProjector();
  const messages = [user, call, result];
  const first = project(messages, { pending, working: true });
  const update = project(messages, { pending: { ...pending, text: "More text" }, working: true });
  assert.equal(update.history, first.history);
  assert.equal(update.history[1], first.history[1]);
  assert.equal(update.pending?.kind, "reply");
  assert.equal(update.pending?.msg.text, "More text");
  assert.equal(first.pending?.msg.text, "Answer ![Image](plot.png)", "old outputs are immutable");
  assert.deepEqual(
    jumpEntries(update.history).map((entry) => entry.id),
    ["top", "user", "bottom"],
  );

  const withCall = project(messages, {
    working: true,
    pending: { ...pending, toolCalls: call.toolCalls },
  });
  assert.equal(withCall.history, first.history);
  assert.ok(withCall.pending?.kind === "reply");
  assert.equal(withCall.pending.tools[0]?.output, "First file");
  assert.equal(withCall.pending.tools[0]?.outcome, "done");
  const error = project(messages, {
    working: true,
    pending: { ...pending, errorMessage: "Provider failed", stopReason: "error" },
  });
  assert.ok(error.pending?.kind === "reply");
  assert.equal(error.pending.error?.summary, "Provider failed");
  assert.equal(error.history, first.history);
  assert.equal(project(messages, { working: true }).pending, undefined);
  assert.equal(project(messages, { pending: call, working: true }).pending, undefined);
});

test("projection invalidates on tools, lifecycle, visibility, completion and context replacement", () => {
  const project = createTranscriptProjector();
  const messages = [user, call];
  const tools: Record<string, ToolExecution> = {
    read: {
      id: "read",
      name: "read",
      args: "",
      text: "Reading",
      status: "running",
      outputKind: "latest-update",
    },
  };
  const live = project(messages, { tools, pending, working: true });
  assert.ok(live.history[1]?.kind === "reply");
  assert.equal(live.history[1].tools[0]?.outcome, "running");
  const failed = project(messages, {
    tools: { read: { ...tools.read!, status: "error", text: "Could not read" } },
    pending,
    working: true,
  });
  assert.ok(failed.history[1]?.kind === "reply");
  assert.equal(failed.history[1].tools[0]?.outcome, "failed");
  assert.equal(failed.history[1].tools[0]?.output, "Could not read");
  const visible = project(messages, { tools, pending, working: true });
  assert.equal(visible.history.length, 2);
  const hidden = project(messages, { tools, pending, working: true, showTools: false });
  assert.deepEqual(
    hidden.history.map((row) => row.key),
    ["user"],
  );
  assert.equal(hidden.pending, undefined);
  const settled = project(messages, { tools, showTools: false, working: false });
  assert.deepEqual(
    jumpEntries(settled.history).map((entry) => entry.id),
    ["top", "user", "call", "bottom"],
  );
  const complete = project([...messages, result, pending], { pending });
  assert.equal(complete.pending, undefined, "history wins over a stale partial of the same id");
  assert.equal(complete.history.at(-1)?.key, live.pending?.key, "completion retains the fold key");
  assert.ok(complete.history.at(-1)?.kind === "reply");
  assert.deepEqual(
    jumpEntries(complete.history).map((entry) => entry.id),
    ["top", "user", "pending", "bottom"],
  );
  const replacement = project(
    [
      { id: "summary", role: "context", label: "Compaction summary", text: "Replaced context" },
      { ...user, text: "A different question" },
    ],
    { pending },
  );
  assert.deepEqual(
    replacement.history.map((row) => row.key),
    ["summary", "user"],
  );
  assert.equal(replacement.history[1]?.msg.text, "A different question");
  assert.equal(replacement.pending?.key, "pending");
  const hiddenDuplicate = project([call], { pending: call, working: true, showTools: false });
  assert.deepEqual(hiddenDuplicate.history, []);
  assert.equal(hiddenDuplicate.pending, undefined, "even a hidden authoritative row wins");
});

test("pending tools use current history's dispatch briefs, nested output and preceding errors, never another session's", () => {
  const project = createTranscriptProjector();
  const messages: RenderMsg[] = [
    user,
    {
      id: "start",
      role: "assistant",
      text: "",
      toolCalls: [
        { id: "dispatch", name: "piano_start_session", args: '{"prompt":"Review the parser"}' },
      ],
    },
    {
      id: "started",
      role: "tool_result",
      toolCallId: "dispatch",
      text: '{"creation":"created","submission":"started","handle":{"sessionId":"child"},"worktree":{"branch":"review-parser"}}',
    },
    call,
    {
      ...result,
      text: "Command aborted",
      isError: true,
      nestedCalls: [
        {
          id: "read/nested",
          name: "read",
          args: '{"path":"nested.ts"}',
          text: "Nested content",
          status: "success",
          outputKind: "final",
        },
      ],
    },
  ];
  const tail: RenderMsg = {
    ...pending,
    text: "",
    toolCalls: [
      { id: "status", name: "piano_session_status", args: '{"sessionId":"child"}' },
      ...call.toolCalls!,
    ],
  };
  const first = project(messages, { pending: tail });
  assert.ok(first.pending?.kind === "reply");
  assert.deepEqual(first.pending.tools[0]?.dispatch, [
    {
      sessionId: "child",
      title: "Review the parser",
      branch: "review-parser",
      status: "Reading",
      badge: "secondary",
    },
  ]);
  assert.equal(first.pending.tools[1]?.nested.calls[0]?.summary, "nested.ts");
  const aborted = {
    ...pending,
    text: "",
    stopReason: "aborted",
    errorMessage: "This operation was aborted",
  };
  assert.equal(
    project(messages, { pending: aborted }).pending,
    undefined,
    "preceding failed tool represents the abort",
  );
  const other = project([{ ...user, text: "Other session" }], { pending: tail });
  assert.ok(other.pending?.kind === "reply");
  assert.deepEqual(other.pending.tools[0]?.dispatch, [
    { sessionId: "child", title: "Session", status: "Reading", badge: "secondary" },
  ]);
  assert.deepEqual(other.pending.tools[1]?.nested.calls, []);
  assert.equal(other.pending.tools[1]?.outcome, "running");
  assert.equal(first.history[0]?.msg.text, "Inspect the files");
  const independent = createTranscriptProjector()([user], { pending: aborted });
  assert.ok(independent.pending?.kind === "reply");
  assert.equal(independent.pending.error?.summary, "This operation was aborted");
});
