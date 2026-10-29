/// <reference lib="dom" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  SessionHandle,
  SessionStatus,
  StartArguments,
  StartToolResult,
  WaitArguments,
  WaitToolResult,
} from "../shared/dispatch.ts";
import type { RenderMsg, ToolExecution } from "../shared/wire.ts";
import { messageError } from "../web/src/lib/messageError.ts";
import {
  jumpEntries,
  nestedStatus,
  revealEntries,
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

test("ask_user joins persisted answers to question text in order, including empty and unanswered items", () => {
  const questions = [
    { id: "database", question: "Which database?", options: ["PostgreSQL", "SQLite"] },
    { id: "requirements", question: "What should change?" },
    { id: "schedule", question: "When?" },
  ];
  const asked: RenderMsg = {
    id: "asked",
    role: "assistant",
    text: "",
    toolCalls: [{ id: "q", name: "ask_user", args: JSON.stringify({ questions }) }],
  };
  const result = (value: unknown): RenderMsg => ({
    id: "answered",
    role: "tool_result",
    toolCallId: "q",
    text: JSON.stringify(value),
  });
  const facts = (response?: RenderMsg) =>
    reply(transcriptRows(response ? [asked, response] : [asked]), "asked").tools[0]?.answers;
  assert.equal(facts(), undefined, "unanswered calls keep the generic running tool row");
  assert.deepEqual(
    facts(
      result({
        status: "answered",
        answers: {
          schedule: "",
          requirements: "Keep the API\nChange the layout",
          database: "SQLite",
        },
      }),
    ),
    {
      status: "answered",
      items: [
        { id: "database", question: "Which database?", answer: "SQLite" },
        {
          id: "requirements",
          question: "What should change?",
          answer: "Keep the API\nChange the layout",
        },
        { id: "schedule", question: "When?", answer: "" },
      ],
    },
  );
  assert.deepEqual(facts(result({ status: "cancelled", answers: { database: "SQLite" } })), {
    status: "cancelled",
    items: [
      { id: "database", question: "Which database?", answer: "SQLite" },
      { id: "requirements", question: "What should change?" },
      { id: "schedule", question: "When?" },
    ],
  });
  for (const value of [
    { status: "answered", answers: {} },
    { status: "cancelled", answers: { database: true } },
    { status: "cancelled", answers: { unknown: "Do not hide this output" } },
  ])
    assert.equal(
      facts(result(value)),
      undefined,
      "malformed/unmatched results retain their raw output",
    );
  assert.equal(
    facts({ ...result({ status: "cancelled", answers: {} }), isError: true }),
    undefined,
  );
  const invalid = { ...asked, toolCalls: [{ ...asked.toolCalls![0]!, args: "{" }] };
  assert.equal(
    reply(transcriptRows([invalid, result({ status: "cancelled", answers: {} })]), "asked").tools[0]
      ?.answers,
    undefined,
  );
});

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

test("revealing a mention tries the message's own row, then the exchange it belongs to", () => {
  const messages: RenderMsg[] = [
    { id: "u1", role: "user", text: "Deploy it" },
    {
      id: "a1",
      role: "assistant",
      text: "Reading https://example.com/docs first",
      toolCalls: [{ id: "t1", name: "bash", args: "{}" }],
    },
    { id: "r1", role: "tool_result", text: "ok", toolCallId: "t1" },
    { id: "a2", role: "assistant", text: "Done, see https://example.com/done" },
    { id: "u2", role: "user", text: "Thanks" },
  ];
  const entries = jumpEntries(transcriptRows(messages));
  assert.deepEqual(
    entries.map((e) => e.id),
    ["top", "u1", "a2", "u2", "bottom"],
    "the intermediate reply is not a destination",
  );
  assert.deepEqual(
    revealEntries(messages, entries, "a1").map((e) => [e.kind, e.id]),
    [
      ["assistant", "a1"],
      ["user", "u1"],
    ],
  );
  assert.deepEqual(
    revealEntries(messages, entries, "a2").map((e) => e.id),
    ["a2", "u1"],
    "a destination's own row comes first; the fallback is the destination before it",
  );
  assert.deepEqual(
    revealEntries(messages, entries, "u1").map((e) => e.id),
    ["u1"],
  );
  assert.deepEqual(revealEntries(messages, entries, "missing"), []);
});

test("a multi-line command's summary is its first line and how many lines follow", () => {
  const command = "python3 - <<'PY'\nimport json\n    print(json.dumps(1))\nPY";
  const rows = transcriptRows([
    {
      id: "a",
      role: "assistant",
      text: "",
      toolCalls: [{ id: "t", name: "bash", args: JSON.stringify({ command }) }],
    },
  ]);
  assert.equal(reply(rows, "a").tools[0]!.summary, "python3 - <<'PY' (+3 lines)");
  const long = transcriptRows([
    {
      id: "b",
      role: "assistant",
      text: "",
      toolCalls: [{ id: "t", name: "bash", args: JSON.stringify({ command: "x".repeat(200) }) }],
    },
  ]);
  const summary = reply(long, "b").tools[0]!.summary;
  assert.equal(summary.length, 160);
  assert.ok(summary.endsWith("…"));
});

test("a tool's output shows as text: terminal colours, hyperlink escapes and \\r go", () => {
  const rows = transcriptRows([
    {
      id: "a",
      role: "assistant",
      text: "",
      toolCalls: [{ id: "t", name: "bash", args: '{"command":"gh pr view"}' }],
    },
    {
      id: "r",
      role: "tool_result",
      toolCallId: "t",
      text: "\x1b[0m\x1b[1mPR:\x1b[0m #149\r\n\x1b]8;;https://x.test\x1b\\\x1b[38;2;1;2;3mlink\x1b[0m\x1b]8;;\x1b\\\n",
      isError: false,
    },
  ]);
  assert.equal(reply(rows, "a").tools[0]!.output, "PR: #149\nlink\n");
});

test("a dispatch names each session it started or waited on, with the parent's observation", () => {
  // Typed against the shared shapes, so a field the extension renames breaks this fixture too.
  const handle: SessionHandle = {
    cwd: "/repo",
    sessionId: "child-1",
    generation: "g1",
    submissionId: 1,
    baselineMessages: 0,
    baselineFingerprint: "b",
    inputFingerprint: "i",
    anchorMessageId: null,
  };
  const brief = "Review the current diff.\nDo not edit files.";
  const params = `prompt:\n${brief}`;
  const start: RenderMsg = {
    id: "start",
    role: "assistant",
    text: "",
    toolCalls: [
      {
        id: "s",
        name: "piano_start_session",
        args: JSON.stringify({ prompt: brief } satisfies StartArguments),
      },
    ],
  };
  const started: RenderMsg = {
    id: "started",
    role: "tool_result",
    toolCallId: "s",
    text: JSON.stringify({
      cwd: "/repo",
      creation: "created",
      submission: "started",
      handle,
      worktree: null,
      link: "http://x/s/child-1",
    } satisfies StartToolResult),
  };
  const wait: RenderMsg = {
    id: "wait",
    role: "assistant",
    text: "",
    toolCalls: [
      {
        id: "w",
        name: "piano_wait_sessions",
        args: JSON.stringify({ sessions: [handle] } satisfies WaitArguments),
      },
    ],
  };
  const waited: RenderMsg = {
    id: "waited",
    role: "tool_result",
    toolCallId: "w",
    text: JSON.stringify({
      results: [
        {
          handle,
          status: "settled",
          ending: "observed",
          answer: "No findings.",
          attribution: "attributed",
          link: "http://x/s/child-1",
        },
      ],
    } satisfies WaitToolResult),
  };
  const dispatch = (messages: RenderMsg[], id: string) =>
    reply(transcriptRows(messages), id).tools[0]?.dispatch;

  assert.deepEqual(dispatch([start], "start"), [
    {
      sessionId: null,
      title: "Review the current diff. Do not edit files.",
      status: "Starting",
      badge: "secondary",
      params,
    },
  ]);
  assert.deepEqual(dispatch([start, started], "start")?.[0], {
    sessionId: "child-1",
    title: "Review the current diff. Do not edit files.",
    status: "Started",
    badge: "secondary",
    params,
  });
  assert.deepEqual(
    dispatch([start, started, wait], "wait")?.map((s) => [s.sessionId, s.title, s.status]),
    [["child-1", "Review the current diff. Do not edit files.", "Waiting"]],
    "a running wait names its sessions by the brief that started them",
  );
  for (const [message, callId] of [
    [start, "s"],
    [wait, "w"],
  ] as const) {
    const tool = reply(
      transcriptRows(callId === "s" ? [start] : [start, started, wait], {
        tools: {
          [callId]: {
            id: callId,
            name: message.toolCalls![0]!.name,
            args: message.toolCalls![0]!.args,
            text: "",
            status: "incomplete",
            outputKind: "unavailable",
          },
        },
      }),
      message.id,
    ).tools[0]!;
    assert.equal(tool.outcome, "incomplete");
    assert.equal(tool.dispatch?.[0]?.status, "Incomplete", "the parent call is no longer active");
    assert.equal(tool.dispatch?.[0]?.badge, "warning");
    assert.equal(tool.dispatch?.[0]?.sessionId, callId === "w" ? "child-1" : null);
  }
  const finished = dispatch([start, started, wait, waited], "wait")?.[0];
  assert.equal(finished?.status, "Finished", "settlement is not called success");
  assert.equal(finished?.answer, "No findings.");

  const refused: RenderMsg = {
    id: "refused",
    role: "tool_result",
    toolCallId: "s",
    text: "A non-empty, self-contained work brief is required.",
    isError: true,
  };
  assert.equal(
    dispatch([start, refused], "start"),
    undefined,
    "a failure the tool reported as text stays an ordinary tool call",
  );
});

test("a dispatch into a new worktree names its branch, and a status read reports what the session needs", () => {
  const handle: SessionHandle = {
    cwd: "/repo/.worktrees/task-a",
    sessionId: "child-a",
    generation: "g1",
    submissionId: 1,
    baselineMessages: 0,
    baselineFingerprint: "b",
    inputFingerprint: "i",
    anchorMessageId: null,
  };
  const call = (id: string, name: string, args: unknown): RenderMsg => ({
    id,
    role: "assistant",
    text: "",
    toolCalls: [{ id, name, args: JSON.stringify(args) }],
  });
  const result = (id: string, value: unknown): RenderMsg => ({
    id: `${id}-result`,
    role: "tool_result",
    toolCallId: id,
    text: JSON.stringify(value),
  });
  const start = call("s", "piano_start_session", {
    prompt: "Fix the login bug.",
    worktree: { branch: "task-a" },
  } satisfies StartArguments);
  const started = result("s", {
    cwd: handle.cwd,
    creation: "created",
    submission: "started",
    handle,
    worktree: { path: handle.cwd, branch: "task-a" },
    link: "http://x/s/child-a",
  } satisfies StartToolResult);
  const wait = call("w", "piano_wait_sessions", { sessions: [handle] } satisfies WaitArguments);
  const status = call("q", "piano_session_status", { sessionId: "child-a" });
  const read = (
    needs: SessionStatus["needs"],
    lastAnswer: string | null,
    changes: SessionStatus["changes"] = { branch: "task-a", files: 2, pullRequest: null },
  ) =>
    result("q", {
      sessionId: "child-a",
      cwd: handle.cwd,
      projectId: null,
      disposition: needs ? "needs_input" : "settled",
      since: "2026-10-21T00:00:00.000Z",
      needs,
      lastAnswer,
      changes,
      link: "http://x/s/child-a",
    } satisfies SessionStatus);
  const dispatch = (messages: RenderMsg[], id: string) =>
    reply(transcriptRows(messages), id).tools[0]?.dispatch?.[0];

  assert.equal(
    dispatch([start], "s")?.branch,
    "task-a",
    "the requested branch shows while starting",
  );
  assert.equal(dispatch([start, started], "s")?.branch, "task-a");
  assert.deepEqual(
    [dispatch([start, started, wait], "w")?.title, dispatch([start, started, wait], "w")?.branch],
    ["Fix the login bug.", "task-a"],
    "a wait names the branch beside the brief",
  );
  const needs = dispatch(
    [
      start,
      started,
      status,
      read({ title: "Allow rm -rf?", kind: "confirm", link: "http://x/s/child-a" }, null),
    ],
    "q",
  );
  assert.deepEqual(
    [needs?.title, needs?.branch, needs?.status, needs?.badge, needs?.detail],
    ["Fix the login bug.", "task-a", "Needs input", "warning", "Allow rm -rf?"],
  );
  const settled = dispatch([status, read(null, "Fixed.")], "q");
  assert.deepEqual(
    [settled?.sessionId, settled?.title, settled?.status, settled?.answer],
    ["child-a", "Session", "Finished", "Fixed."],
    "a session this transcript did not start is still named by its ID's row",
  );
  const detached = { branch: null, files: 0, pullRequest: null };
  assert.equal(
    dispatch([start, started, status, read(null, "Fixed.", detached)], "q")?.branch,
    "Detached HEAD",
    "a checkout Git lists on no branch is labelled as Changes labels it, not by the dispatched branch",
  );
  assert.equal(
    dispatch([start, started, status, read(null, "Fixed.", null)], "q")?.branch,
    "task-a",
    "outside a Git checkout the dispatched branch still names the row",
  );
  assert.equal(
    dispatch([status, { ...read(null, null), text: "Piano lists no session child-a." }], "q"),
    undefined,
    "an unknown session stays an ordinary tool call",
  );
});
