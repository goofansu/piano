/// <reference lib="dom" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg, SubagentCard, ToolExecution } from "../shared/wire.ts";
import { messageError } from "../web/src/lib/messageError.ts";
import {
  jumpEntries,
  nestedStatus,
  type TranscriptOptions,
  type TranscriptRow,
  transcriptRows,
} from "../web/src/lib/transcript.ts";

const jumps = (messages: ReadonlyArray<RenderMsg>) => jumpEntries(transcriptRows(messages));
const ids = (rows: TranscriptRow[]) => rows.map((row) => row.msg.id);
const reply = (rows: TranscriptRow[], id: string) => {
  const row = rows.find((r) => r.msg.id === id);
  assert.ok(row?.kind === "reply", `${id} is a reply row`);
  return row;
};

const apiError =
  'exe-dev-openai API error (429): {"type":"usage_limit_reached","message":"The usage limit has been reached","retry_after":123}';
const failure = (errorMessage = apiError): RenderMsg => ({
  id: "error",
  role: "assistant",
  text: "",
  stopReason: "error",
  errorMessage,
});
const call: RenderMsg = {
  id: "call",
  role: "assistant",
  text: "",
  toolCalls: [{ id: "sleep", name: "bash", args: '{"command":"sleep 30"}' }],
};
const result: RenderMsg = {
  id: "result",
  role: "tool_result",
  toolCallId: "sleep",
  text: "Command aborted",
  isError: true,
};
const abort = failure("This operation was aborted");
/** The error shown for the message with id "error", if any. */
const errorOf = (messages: RenderMsg[], options: TranscriptOptions = {}) => {
  const row = transcriptRows(messages, options).find((r) => r.msg.id === "error");
  return row?.kind === "reply" ? row.error?.summary : undefined;
};

test("jumper previews prompts and final replies, not tool-only or intermediate assistant turns", () => {
  const messages: RenderMsg[] = [
    { id: "u1", role: "user", text: "Inspect the files" },
    {
      id: "a1",
      role: "assistant",
      text: "",
      toolCalls: [{ id: "call", name: "bash", args: "{}" }],
    },
    { id: "r1", role: "tool_result", text: "files", toolCallId: "call" },
    { id: "intermediate", role: "assistant", text: "Inspecting the files now" },
    { id: "a2", role: "assistant", text: "Here are the files" },
    { id: "u2", role: "user", text: "Thanks" },
    { id: "a3", role: "assistant", text: "You're welcome" },
  ];
  const destinations = jumps(messages).filter((entry) => "messageId" in entry);
  assert.deepEqual(
    destinations.map((entry) => entry.id),
    ["u1", "a2", "u2", "a3"],
  );
  assert.equal(destinations[1]!.label, "Here are the files");
});

test("a prompt is reachable before the first assistant response", () => {
  assert.deepEqual(
    jumps([{ id: "u1", role: "user", text: "Hello" }]).map((entry) => entry.kind),
    ["top", "user", "bottom"],
  );
});

test("a skill prompt is listed as the command that was typed, never as Pi's expansion markup", () => {
  const skill = {
    name: "research",
    location: "/home/me/.pi/agent/skills/research/SKILL.md",
    body: "# Research\n\nLook things up.",
  };
  const entries = jumps([
    { id: "u1", role: "user", text: "the changelog", skill },
    { id: "u2", role: "user", text: "", skill },
  ]);
  assert.deepEqual(
    entries.filter((entry) => entry.kind === "user").map((entry) => entry.label),
    ["/skill:research the changelog", "/skill:research"],
  );
});

test("a tool result folds under its call wherever the call sits; an orphan stands alone", () => {
  const orphan: RenderMsg = {
    id: "orphan",
    role: "tool_result",
    toolCallId: "gone",
    toolName: "read",
    text: "Hidden tool output",
  };
  const rows = transcriptRows([result, call, orphan]);
  assert.deepEqual(ids(rows), ["call", "orphan"]);
  assert.equal(reply(rows, "call").tools[0]!.result, result);
  const alone = rows[1]!;
  assert.ok(alone.kind === "orphan");
  assert.deepEqual(alone.tool.call, { id: "gone", name: "read", args: "" });
});

test("a pending reply's unanswered call is running until an execution or result says otherwise", () => {
  const pending = {
    ...call,
    id: "pending",
    toolCalls: ["a", "b", "c"].map((id) => ({ id, name: "bash", args: "" })),
  };
  const tools: Record<string, ToolExecution> = {
    b: { id: "b", name: "bash", args: "", text: "", status: "success", outputKind: "final" },
  };
  const rows = transcriptRows([{ id: "rc", role: "tool_result", toolCallId: "c", text: "done" }], {
    pending,
    tools,
  });
  assert.deepEqual(
    reply(rows, "pending").tools.map((tool) => tool.outcome),
    ["running", "pending", "done"],
  );
  const final = { ...pending, id: "e2" };
  const streaming = transcriptRows([], { pending: final }).at(-1)!;
  const ended = transcriptRows([final]).at(-1)!;
  assert.equal(streaming.key, ended.key, "a reply keeps its row key when it stops streaming");
  assert.deepEqual(
    transcriptRows([final], { pending: final }).map((row) => row.key),
    ["e2"],
    "a partial already in history is shown once",
  );
});

test("a call's outcome, verb and visible output come from its result, else its execution", () => {
  const calls = ["ok", "err", "cut", "live", "quiet"].map((id) => ({
    id,
    name: id === "quiet" ? "fetch" : "bash",
    args: '{"command":"make test"}',
  }));
  const tools: Record<string, ToolExecution> = {
    err: { id: "err", name: "bash", args: "", text: "boom", status: "error", outputKind: "final" },
    cut: {
      id: "cut",
      name: "bash",
      args: "",
      text: "partial",
      status: "incomplete",
      outputKind: "latest-update",
    },
    live: {
      id: "live",
      name: "bash",
      args: "",
      text: "",
      status: "running",
      outputKind: "latest-update",
    },
  };
  const rows = transcriptRows(
    [
      { id: "a", role: "assistant", text: "", toolCalls: calls },
      { id: "r", role: "tool_result", toolCallId: "ok", text: "passed" },
    ],
    { tools },
  );
  const facts = reply(rows, "a").tools.map(({ outcome, verb, output, knownTool }) => ({
    outcome,
    verb,
    output,
    knownTool,
  }));
  assert.deepEqual(facts, [
    { outcome: "done", verb: "Ran", output: "passed", knownTool: true },
    { outcome: "failed", verb: "Failed", output: "boom", knownTool: true },
    { outcome: "incomplete", verb: "Incomplete", output: "partial", knownTool: true },
    { outcome: "running", verb: "Running", output: "", knownTool: true },
    { outcome: "pending", verb: "Called", output: undefined, knownTool: false },
  ]);
  assert.equal(reply(rows, "a").tools[0]!.summary, "make test");
  assert.equal(
    reply(transcriptRows([call, result]), "call").tools[0]!.outcome,
    "failed",
    "an error result fails the call",
  );
});

test("a call's nested calls are those its result recorded plus live executions it parents, and no others", () => {
  const exec = (id: string, parentId?: string): ToolExecution => ({
    id,
    ...(parentId ? { parentId } : {}),
    name: "read",
    args: "",
    text: id,
    status: "running",
    outputKind: "latest-update",
  });
  const recorded = exec("task/1");
  const tools = {
    task: exec("task"),
    "task/1": { ...recorded, text: "newer" },
    "task/2": exec("task/2"),
    child: exec("child", "task"),
    other: exec("other"),
    "taskish/1": exec("taskish/1"),
  };
  const history: RenderMsg[] = [
    {
      id: "a",
      role: "assistant",
      text: "",
      toolCalls: [
        { id: "task", name: "task", args: "{}" },
        { id: "other", name: "bash", args: "{}" },
      ],
    },
    {
      id: "r",
      role: "tool_result",
      toolCallId: "task",
      text: "",
      nestedCalls: [recorded],
      nestedCallsComplete: false,
    },
  ];
  const [task, other] = reply(transcriptRows(history, { tools }), "a").tools;
  assert.deepEqual(
    task!.nested.map((c) => [c.id, c.text]),
    [
      ["task/1", "newer"],
      ["task/2", "task/2"],
      ["child", "child"],
    ],
  );
  assert.equal(task!.nestedComplete, false);
  assert.deepEqual([other!.nested, other!.nestedComplete], [[], true]);
});

test("a delegation card shows its run's settled status from a later card, with badge and label agreeing", () => {
  const delegation = (id: string): RenderMsg => ({
    id,
    role: "tool_result",
    toolCallId: id,
    text: "",
    subagent: {
      kind: "delegation",
      action: "start",
      runId: `run-${id}`,
      status: "Started",
      admitted: true,
    },
  });
  const history: RenderMsg[] = [
    {
      id: "a",
      role: "assistant",
      text: "",
      toolCalls: ["d1", "d2", "d3"].map((id) => ({ id, name: "subagent", args: "{}" })),
    },
    delegation("d1"),
    delegation("d2"),
    delegation("d3"),
    {
      id: "n",
      role: "tool_result",
      text: "Done",
      subagent: {
        kind: "result",
        source: "notification",
        runId: "run-d1",
        status: "Completed",
        terminalStatus: "completed",
        attention: false,
      },
    },
    {
      id: "c",
      role: "tool_result",
      text: "",
      subagent: {
        kind: "cancellation",
        status: "Checked",
        outcomes: [{ kind: "already terminal", runId: "run-d2", phase: "failed" }],
        attention: false,
      },
    },
  ];
  const rows = transcriptRows(history);
  const cards = reply(rows, "a").tools.map((tool) => tool.subagent!);
  assert.deepEqual(
    cards.map(({ terminal, statusLabel, badge }) => ({ terminal, statusLabel, badge })),
    [
      { terminal: "completed", statusLabel: "Completed", badge: "success" },
      { terminal: "failed", statusLabel: "Failed", badge: "destructive" },
      { terminal: undefined, statusLabel: "Started", badge: "secondary" },
    ],
  );
  const notice = rows.find((row) => row.msg.id === "n");
  assert.ok(notice?.kind === "subagent");
  assert.deepEqual(
    [
      notice.subagent.terminal,
      notice.subagent.statusLabel,
      notice.subagent.body.outputs[0]?.text,
      notice.subagent.hasDetails,
    ],
    ["completed", "Completed", "Done", true],
  );

  const updated = transcriptRows([
    ...history,
    {
      id: "wait",
      role: "tool_result",
      text: "",
      subagent: {
        kind: "collection",
        scope: "named",
        status: "Delivered 2 results",
        runs: [
          { runId: "run-d1", profile: "reviewer", status: "failed" },
          { runId: "run-d2", profile: "reviewer", status: "completed" },
        ],
        stillRunning: 1,
        unknown: 0,
        unavailable: 0,
        noActiveRuns: false,
        attention: true,
      },
    },
    {
      id: "requested",
      role: "tool_result",
      text: "",
      subagent: {
        kind: "cancellation",
        status: "Cancellation requested",
        outcomes: [
          { kind: "requested", runId: "run-d1" },
          { kind: "requested", runId: "run-d3" },
        ],
        attention: true,
      },
    },
    {
      id: "query",
      role: "tool_result",
      text: "",
      subagent: {
        kind: "result",
        source: "tool",
        runId: "run-d1",
        status: "Still running when checked",
        attention: true,
      },
    },
  ]);
  assert.deepEqual(
    reply(updated, "a").tools.map((tool) => [
      tool.subagent!.terminal,
      tool.subagent!.statusLabel,
      tool.subagent!.badge,
    ]),
    [
      ["failed", "Failed", "destructive"],
      ["completed", "Completed", "success"],
      [undefined, "Started", "secondary"],
    ],
    "the last qualifying collection overrides earlier outcomes; requests and nonterminal queries neither settle nor erase them",
  );
  const originalNotice = updated.find((row) => row.msg.id === "n");
  assert.ok(originalNotice?.kind === "subagent");
  assert.deepEqual(
    [originalNotice.subagent.terminal, originalNotice.subagent.statusLabel],
    ["completed", "Completed"],
    "reported outcomes update delegations, not other result cards",
  );
});

test("a card's own settled status keeps its clauses in the details, and its label never contradicts the badge", () => {
  const card = (status: string): RenderMsg => ({
    id: status,
    role: "tool_result",
    text: "",
    subagent: {
      kind: "result",
      source: "tool",
      status,
      terminalStatus: "failed",
      attention: false,
    },
  });
  const labels = transcriptRows([
    card("Failed · Result unavailable"),
    card("Started"),
    card("Started · for a while"),
  ]).map(
    (row) =>
      row.kind === "subagent" && [
        row.subagent.statusLabel,
        row.subagent.body.status,
        row.subagent.badge,
        row.subagent.hasDetails,
      ],
  );
  assert.deepEqual(labels, [
    ["Failed", "Failed · Result unavailable", "destructive", true],
    ["Failed", undefined, "destructive", false],
    // A clause that qualified the card's own head would misdescribe the settled status.
    ["Failed", undefined, "destructive", false],
  ]);
});

const cardRow = (id: string, subagent: SubagentCard, text = ""): RenderMsg => ({
  id,
  role: "tool_result",
  text,
  subagent,
});
const cardFacts = (messages: RenderMsg[]) =>
  transcriptRows(messages).flatMap((row) => (row.kind === "subagent" ? [row.subagent] : []));

test("each subagent card kind has its title and accessible name, and opens exactly when it has details", () => {
  const facts = cardFacts([
    cardRow("refused", { kind: "delegation", action: "start", status: "Refused", admitted: false }),
    cardRow("resumed", {
      kind: "delegation",
      action: "resume",
      label: "Fix tests",
      subagentId: "sub-1",
      runId: "run-1",
      prompt: "Fix them",
      status: "Resumed",
      admitted: true,
    }),
    cardRow("steer", {
      kind: "control",
      action: "steer",
      message: "Hurry",
      status: "Accepted",
      attention: false,
    }),
    cardRow("wait", {
      kind: "collection",
      scope: "named",
      status: "Delivered 1 result · 1 unavailable · 2 unknown",
      runs: [{ runId: "run-1", profile: "reviewer", status: "completed" }],
      stillRunning: 0,
      unknown: 2,
      unavailable: 1,
      noActiveRuns: false,
      attention: true,
    }),
    cardRow("instant", {
      kind: "result",
      source: "notification",
      status: "Completed",
      terminalStatus: "completed",
      durationMillis: 0,
      attention: false,
    }),
    cardRow("bare", { kind: "result", source: "tool", status: "unknown Run", attention: true }),
    cardRow(
      "answered",
      { kind: "result", source: "tool", status: "unknown Run", attention: true },
      "Answer",
    ),
    cardRow("cancel", {
      kind: "cancellation",
      status: "Checked",
      outcomes: [
        { kind: "requested", runId: "run-2" },
        { kind: "already terminal", runId: "run-1", phase: "completed" },
      ],
      attention: true,
    }),
    cardRow("empty", {
      kind: "cancellation",
      status: "No run ids were given",
      outcomes: [],
      attention: false,
    }),
  ]);
  assert.deepEqual(
    facts.map(({ title, ariaLabel, isResult, hasDetails }) => [
      title,
      ariaLabel,
      isResult,
      hasDetails,
    ]),
    [
      ["Delegate task", "Delegation: Delegate task", false, false],
      ["Fix tests", "Delegation: Fix tests", false, true],
      ["Subagent guidance", "Subagent operation: Subagent guidance", false, true],
      ["Subagent results", "Subagent result: Subagent results", true, true],
      ["Subagent result", "Subagent result: Subagent result", true, true],
      ["Subagent result", "Subagent result: Subagent result", true, false],
      ["Subagent result", "Subagent result: Subagent result", true, true],
      ["Subagent cancellation", "Subagent operation: Subagent cancellation", false, true],
      ["Subagent cancellation", "Subagent operation: Subagent cancellation", false, false],
    ],
  );
  for (const { hasDetails, body, title } of facts)
    assert.equal(
      hasDetails,
      !!(body.status || body.input || body.outputs.length || body.meta),
      title,
    );
  // The opened row's slots: a status line, what was sent, what came back, one quiet meta line.
  assert.deepEqual(
    facts.map((card) => card.body),
    [
      { outputs: [] },
      { input: "Fix them", outputs: [], meta: "sub-1 · run-1" },
      { input: "Hurry", outputs: [] },
      { status: "Delivered 1 result · 1 unavailable · 2 unknown", outputs: [] },
      { outputs: [], meta: "0.0s" },
      { outputs: [] },
      { outputs: [{ text: "Answer", markdown: false }] },
      {
        outputs: [
          { label: "run-2 · requested", markdown: false },
          { label: "run-1 · already terminal · completed", markdown: false },
        ],
      },
      { outputs: [] },
    ],
  );
});

test("a subagent card's badge warns only on attention, after its Run's outcome and a refused delegation", () => {
  const delegation = (id: string, admitted = true): RenderMsg =>
    cardRow(id, {
      kind: "delegation",
      action: "start",
      runId: `run-${id}`,
      status: admitted ? "Started" : "Start refused · unknown Agent",
      admitted,
    });
  const facts = cardFacts([
    delegation("cancelled"),
    delegation("open"),
    delegation("refused", false),
    cardRow("checked", {
      kind: "result",
      source: "tool",
      runId: "run-open",
      status: "Still running when checked",
      attention: true,
    }),
    cardRow("expired", {
      kind: "result",
      source: "tool",
      runId: "run-expired",
      status: "Failed · Result unavailable",
      terminalStatus: "failed",
      attention: true,
    }),
    cardRow("steer", {
      kind: "control",
      action: "steer",
      runId: "run-open",
      status: "Control refused · mailbox full",
      attention: false,
    }),
    cardRow("steer-unknown", {
      kind: "control",
      action: "steer",
      runId: "run-gone",
      status: "Control refused · unknown Run",
      attention: true,
    }),
    cardRow("cancel", {
      kind: "cancellation",
      status: "Already finished: 1",
      outcomes: [{ kind: "already terminal", runId: "run-cancelled", phase: "cancelled" }],
      attention: false,
    }),
  ]);
  // The status's clauses are not in the header: the whole phrase is the body's status line.
  assert.deepEqual(
    facts.map((card) => [card.terminal, card.statusLabel, card.body.status, card.badge, card.dot]),
    [
      ["cancelled", "Cancelled", undefined, "secondary", "idle"],
      [undefined, "Started", undefined, "secondary", "idle"],
      [undefined, "Start refused", "Start refused · unknown Agent", "destructive", "idle"],
      [undefined, "Still running when checked", undefined, "warning", "idle"],
      ["failed", "Failed", "Failed · Result unavailable", "destructive", "err"],
      [undefined, "Control refused", "Control refused · mailbox full", "secondary", "idle"],
      [undefined, "Control refused", "Control refused · unknown Run", "warning", "idle"],
      [undefined, "Already finished: 1", undefined, "secondary", "idle"],
    ],
  );
});

test("a subagent card's dot shows a failed call even when its Run completed", () => {
  const rows = transcriptRows([
    {
      id: "a",
      role: "assistant",
      text: "",
      toolCalls: [
        { id: "ok", name: "agent_result", args: "{}" },
        { id: "bad", name: "agent_result", args: "{}" },
      ],
    },
    ...["ok", "bad"].map(
      (id): RenderMsg => ({
        id: `r-${id}`,
        role: "tool_result",
        toolCallId: id,
        text: "",
        isError: id === "bad",
        subagent: {
          kind: "result",
          source: "tool",
          runId: "run-1",
          status: "Completed",
          terminalStatus: "completed",
          attention: false,
        },
      }),
    ),
  ]);
  assert.deepEqual(
    reply(rows, "a").tools.map((tool) => [tool.subagent!.dot, tool.subagent!.badge]),
    [
      ["ok", "success"],
      ["err", "success"],
    ],
  );
});

test("a nested call's badge names what became of it", () => {
  assert.deepEqual((["running", "success", "error", "incomplete"] as const).map(nestedStatus), [
    { label: "Running", badge: "warning" },
    { label: "Done", badge: "success" },
    { label: "Failed", badge: "destructive" },
    { label: "Incomplete", badge: "secondary" },
  ]);
});

test("a failed aborted tool replaces only the duplicated abort, including pending and reload views", () => {
  assert.equal(errorOf([call, result, abort]), undefined);
  assert.equal(errorOf([call, result], { pending: abort }), undefined);
  assert.equal(errorOf([{ ...call, ...abort, toolCalls: call.toolCalls }, result]), undefined);
  const execution: ToolExecution = {
    id: "sleep",
    name: "bash",
    args: call.toolCalls![0]!.args,
    text: "Command aborted",
    status: "error",
    outputKind: "final",
  };
  assert.equal(errorOf([call, abort], { tools: { sleep: execution } }), undefined);
  assert.equal(
    errorOf([], {
      tools: { sleep: execution },
      pending: { ...call, ...abort, toolCalls: call.toolCalls },
    }),
    undefined,
  );
  assert.deepEqual(
    ids(transcriptRows([call, result, abort])),
    ["call"],
    "no empty row is left where the abort was",
  );
});

test("unrelated genuine errors and unrepresented aborts remain visible", () => {
  const aborted = "This operation was aborted";
  assert.equal(errorOf([call, result, failure()]), "The usage limit has been reached");
  assert.equal(errorOf([abort]), aborted);
  assert.equal(errorOf([call, { ...result, text: "Permission denied" }, abort]), aborted);
  assert.equal(errorOf([call, { ...result, isError: false }, abort]), aborted);
  assert.equal(
    errorOf([call, result, { id: "next", role: "user", text: "Next turn" }, abort]),
    aborted,
  );
  assert.equal(
    errorOf([call, result, { id: "reply", role: "assistant", text: "Continuing" }, abort]),
    aborted,
  );
  assert.match(
    errorOf([call, result, failure("The operation was aborted because credentials expired")]) ?? "",
    /credentials expired/,
  );
  assert.equal(errorOf([call, { ...result, toolCallId: "unrelated" }, abort]), aborted);
});

test("messages-only keeps prompts, final replies and errors, and hides activity and intermediate prose", () => {
  const history: RenderMsg[] = [
    { id: "user", role: "user", text: "My question" },
    { ...call, text: "Partial reply" },
    result,
    { id: "orphan", role: "tool_result", toolName: "read", text: "Hidden tool output" },
    { id: "context", role: "context", label: "Compaction summary", text: "Summary" },
    { ...abort, id: "abort" },
    failure(),
  ];
  const pending = { ...call, id: "pending", text: "Streaming reply" };
  const rows = transcriptRows(history, { pending, showTools: false });
  assert.deepEqual(ids(rows), ["user", "abort", "error"]);
  // The tool activity that would explain the abort is hidden, so the abort itself shows.
  assert.equal(reply(rows, "abort").error?.summary, "This operation was aborted");
  for (const row of rows)
    if (row.kind === "reply") assert.deepEqual([row.text, row.tools], ["", []]);
  assert.deepEqual(transcriptRows([call], { pending: call, showTools: false }), []);
  // With tools shown, the failed call already says it was aborted.
  assert.deepEqual(ids(transcriptRows(history, { pending })), [
    "user",
    "call",
    "orphan",
    "context",
    "error",
    "pending",
  ]);
});

test("both displays list every Jump to destination as a row, and messages-only lists nothing else", () => {
  const history: RenderMsg[] = [
    { id: "user", role: "user", text: "My question" },
    { id: "commentary", role: "assistant", text: "Intermediate commentary" },
    call,
    result,
    { id: "final", role: "assistant", text: "Final answer" },
    {
      id: "image",
      role: "user",
      text: "",
      attachments: [{ kind: "image", url: "data:image/png;base64,abc" }],
    },
    { id: "next", role: "assistant", text: "Next final answer" },
  ];
  const destinations = ["user", "final", "image", "next"];
  assert.deepEqual(
    jumps(history).flatMap((entry) => ("messageId" in entry ? [entry.messageId] : [])),
    destinations,
  );
  assert.deepEqual(ids(transcriptRows(history, { showTools: false })), destinations);
  const all = transcriptRows(history, {
    pending: { id: "pending", role: "assistant", text: "Unfinished reply" },
  });
  assert.deepEqual(
    all.flatMap((row) => ("jump" in row && row.jump ? [row.msg.id] : [])),
    destinations,
    "a pending reply is never a destination",
  );
});

test("summarization retains exact raw details and safely falls back for unknown payloads", () => {
  const present = (raw: string) => messageError(failure(raw), [], new Map(), {});
  assert.deepEqual(present(apiError), {
    summary: "The usage limit has been reached",
    details: apiError,
  });
  const nested = 'provider API error (500): {"error":{"message":"Try again later"}}';
  assert.deepEqual(present(nested), { summary: "Try again later", details: nested });
  for (const raw of [
    "Connection refused",
    "provider API error (500): {broken",
    'provider API error (500): {"message":42}',
    "provider API error (500): null",
  ]) {
    assert.deepEqual(present(raw), { summary: raw });
  }
  const long = `Provider failed: ${"details ".repeat(100)}`;
  assert.equal(present(long)?.details, long);
  assert.ok(present(long)!.summary.length <= 240);
});

test("a subagent card's output is Markdown exactly when Pi inserted it as context", () => {
  const card: SubagentCard = { kind: "result", source: "tool", status: "Done", attention: false };
  assert.deepEqual(
    cardFacts([
      { ...cardRow("tool", card, "raw output"), role: "tool_result" },
      { ...cardRow("note", card, "**Found it**"), role: "context" },
    ]).map((facts) => facts.body.outputs[0]?.markdown),
    [false, true],
  );
});

test("a delivered Run's answer is its final output fact, else the raw text, with the retention noted", () => {
  const result = (id: string, extra: Record<string, unknown>, text = "raw prose"): RenderMsg => ({
    id,
    role: "context",
    text,
    subagent: {
      kind: "result",
      source: "notification",
      runId: `run-${id}`,
      status: "Completed",
      terminalStatus: "completed",
      attention: false,
      ...extra,
    } as SubagentCard,
  });
  const facts = cardFacts([
    result("legacy", {}),
    result("whole", { finalOutput: { kind: "retained", text: "# Answer\n\nDone." } }),
    result("preview", { finalOutput: { kind: "retained", preview: "1 2 3 4 5" } }),
    result("cut", { finalOutput: { kind: "retained-prefix", removedBytes: 900, text: "1 2 3" } }),
    result("gone", {
      finalOutput: { kind: "removed", removedBytes: 70000, hasTranscriptEvidence: true },
    }),
    result("none", {
      finalOutput: { kind: "absent", hasTranscriptEvidence: false },
      status: "Failed · Provider overloaded",
      terminalStatus: "failed",
      failure: "Provider overloaded",
    }),
  ]);
  assert.deepEqual(
    facts.map(({ body, statusLabel }) => [
      body.outputs[0]?.text,
      body.outputs[0]?.markdown,
      statusLabel,
      body.status,
    ]),
    [
      ["raw prose", true, "Completed", undefined],
      ["# Answer\n\nDone.", true, "Completed", undefined],
      ["1 2 3 4 5", false, "Completed", "Preview · the whole answer is in the Run's Result"],
      ["1 2 3", true, "Completed", "Beginning only · 900 bytes cut"],
      [undefined, undefined, "Completed", "Output removed · 70000 bytes"],
      [undefined, undefined, "Failed", "Failed · Provider overloaded"],
    ],
  );
});

test("a wait that delivered one Run speaks for that Run: its answer, and its spend on the meta line", () => {
  const [facts] = cardFacts([
    cardRow("wait", {
      kind: "collection",
      scope: "named",
      runId: "run-1",
      subagentId: "sub-1",
      profile: "reviewer",
      status: "Completed",
      terminalStatus: "completed",
      finalOutput: { kind: "retained", text: "All green." },
      durationMillis: 2700,
      runs: [
        {
          runId: "run-1",
          profile: "reviewer",
          status: "completed",
          usage: { input: 3506, output: 9, cacheRead: 0, cacheWrite: 0, cost: 0.0076 },
          model: "openai/gpt-6.1-sol",
          finalOutput: { kind: "retained", text: "All green." },
          durationMillis: 2700,
        },
      ],
      stillRunning: 0,
      unknown: 0,
      unavailable: 0,
      noActiveRuns: false,
      attention: false,
    }),
  ]);
  assert.deepEqual(facts!.body, {
    outputs: [{ text: "All green.", markdown: true }],
    meta: "sub-1 · run-1 · 2.7s · $0.0076 · openai/gpt-6.1-sol",
  });
});

test("a wait over several Runs labels each block as the meta line would: id, profile, status, spend", () => {
  const run = (n: number) => ({
    runId: `run-${n}`,
    profile: "general-purpose",
    status: "completed" as const,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.0144 },
    model: "claude-opus-5",
    finalOutput: { kind: "retained" as const, text: `hi ${n}` },
    durationMillis: 8900,
  });
  const [facts] = cardFacts([
    cardRow("wait", {
      kind: "collection",
      scope: "named",
      status: "Delivered 2 results",
      runs: [run(1), run(3)],
      stillRunning: 0,
      unknown: 0,
      unavailable: 0,
      noActiveRuns: false,
      attention: false,
    }),
  ]);
  assert.deepEqual(
    facts!.body.outputs.map((o) => o.label),
    [
      "run-1 · general-purpose · completed · 8.9s · $0.0144 · claude-opus-5",
      "run-3 · general-purpose · completed · 8.9s · $0.0144 · claude-opus-5",
    ],
  );
});
