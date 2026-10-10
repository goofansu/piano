/// <reference lib="dom" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg, ToolExecution } from "../shared/wire.ts";
import { messageError } from "../web/src/lib/messageError.ts";
import { jumpEntries, type TranscriptOptions, type TranscriptRow, transcriptRows } from "../web/src/lib/transcript.ts";

const jumps = (messages: ReadonlyArray<RenderMsg>) => jumpEntries(transcriptRows(messages));
const ids = (rows: TranscriptRow[]) => rows.map(row => row.msg.id);
const reply = (rows: TranscriptRow[], id: string) => {
  const row = rows.find(r => r.msg.id === id);
  assert.ok(row?.kind === "reply", `${id} is a reply row`);
  return row;
};

const apiError = 'exe-dev-openai API error (429): {"type":"usage_limit_reached","message":"The usage limit has been reached","retry_after":123}';
const failure = (errorMessage = apiError): RenderMsg => ({ id: "error", role: "assistant", text: "", stopReason: "error", errorMessage });
const call: RenderMsg = { id: "call", role: "assistant", text: "", toolCalls: [{ id: "sleep", name: "bash", args: '{"command":"sleep 30"}' }] };
const result: RenderMsg = { id: "result", role: "tool_result", toolCallId: "sleep", text: "Command aborted", isError: true };
const abort = failure("This operation was aborted");
/** The error shown for the message with id "error", if any. */
const errorOf = (messages: RenderMsg[], options: TranscriptOptions = {}) => {
  const row = transcriptRows(messages, options).find(r => r.msg.id === "error");
  return row?.kind === "reply" ? row.error?.summary : undefined;
};

test("jumper previews prompts and final replies, not tool-only or intermediate assistant turns", () => {
  const messages: RenderMsg[] = [
    { id: "u1", role: "user", text: "Inspect the files" },
    { id: "a1", role: "assistant", text: "", toolCalls: [{ id: "call", name: "bash", args: "{}" }] },
    { id: "r1", role: "tool_result", text: "files", toolCallId: "call" },
    { id: "intermediate", role: "assistant", text: "Inspecting the files now" },
    { id: "a2", role: "assistant", text: "Here are the files" },
    { id: "u2", role: "user", text: "Thanks" },
    { id: "a3", role: "assistant", text: "You're welcome" },
  ];
  const destinations = jumps(messages).filter(entry => "messageId" in entry);
  assert.deepEqual(destinations.map(entry => entry.id), ["u1", "a2", "u2", "a3"]);
  assert.equal(destinations[1]!.label, "Here are the files");
});

test("a prompt is reachable before the first assistant response", () => {
  assert.deepEqual(jumps([{ id: "u1", role: "user", text: "Hello" }]).map(entry => entry.kind), ["top", "user", "bottom"]);
});

test("a skill prompt is listed as the command that was typed, never as Pi's expansion markup", () => {
  const skill = { name: "research", location: "/home/me/.pi/agent/skills/research/SKILL.md", body: "# Research\n\nLook things up." };
  const entries = jumps([
    { id: "u1", role: "user", text: "the changelog", skill },
    { id: "u2", role: "user", text: "", skill },
  ]);
  assert.deepEqual(entries.filter(entry => entry.kind === "user").map(entry => entry.label), ["/skill:research the changelog", "/skill:research"]);
});

test("a tool result folds under its call wherever the call sits; an orphan stands alone", () => {
  const orphan: RenderMsg = { id: "orphan", role: "tool_result", toolCallId: "gone", toolName: "read", text: "Hidden tool output" };
  const rows = transcriptRows([result, call, orphan]);
  assert.deepEqual(ids(rows), ["call", "orphan"]);
  assert.equal(reply(rows, "call").tools[0]!.result, result);
  const alone = rows[1]!;
  assert.ok(alone.kind === "orphan");
  assert.deepEqual(alone.tool.call, { id: "gone", name: "read", args: "" });
});

test("a pending reply's unanswered call is running until an execution or result says otherwise", () => {
  const pending = { ...call, id: "pending", toolCalls: ["a", "b", "c"].map(id => ({ id, name: "bash", args: "" })) };
  const tools: Record<string, ToolExecution> = { b: { id: "b", name: "bash", args: "", text: "", status: "success", outputKind: "final" } };
  const rows = transcriptRows([{ id: "rc", role: "tool_result", toolCallId: "c", text: "done" }], { pending, tools });
  assert.deepEqual(reply(rows, "pending").tools.map(tool => tool.running), [true, false, false]);
  assert.equal(rows.at(-1)!.key, "pending:pending", "a pending row never shares a key with the message it becomes");
});

test("a failed aborted tool replaces only the duplicated abort, including pending and reload views", () => {
  assert.equal(errorOf([call, result, abort]), undefined);
  assert.equal(errorOf([call, result], { pending: abort }), undefined);
  assert.equal(errorOf([{ ...call, ...abort, toolCalls: call.toolCalls }, result]), undefined);
  const execution: ToolExecution = { id: "sleep", name: "bash", args: call.toolCalls![0]!.args, text: "Command aborted", status: "error", outputKind: "final" };
  assert.equal(errorOf([call, abort], { tools: { sleep: execution } }), undefined);
  assert.equal(errorOf([], { tools: { sleep: execution }, pending: { ...call, ...abort, toolCalls: call.toolCalls } }), undefined);
  assert.deepEqual(ids(transcriptRows([call, result, abort])), ["call"], "no empty row is left where the abort was");
});

test("unrelated genuine errors and unrepresented aborts remain visible", () => {
  const aborted = "This operation was aborted";
  assert.equal(errorOf([call, result, failure()]), "The usage limit has been reached");
  assert.equal(errorOf([abort]), aborted);
  assert.equal(errorOf([call, { ...result, text: "Permission denied" }, abort]), aborted);
  assert.equal(errorOf([call, { ...result, isError: false }, abort]), aborted);
  assert.equal(errorOf([call, result, { id: "next", role: "user", text: "Next turn" }, abort]), aborted);
  assert.equal(errorOf([call, result, { id: "reply", role: "assistant", text: "Continuing" }, abort]), aborted);
  assert.match(errorOf([call, result, failure("The operation was aborted because credentials expired")]) ?? "", /credentials expired/);
  assert.equal(errorOf([call, { ...result, toolCallId: "unrelated" }, abort]), aborted);
});

test("messages-only keeps prompts, final replies and errors, and hides activity and intermediate prose", () => {
  const history: RenderMsg[] = [
    { id: "user", role: "user", text: "My question" },
    { ...call, text: "Partial reply" }, result,
    { id: "orphan", role: "tool_result", toolName: "read", text: "Hidden tool output" },
    { id: "context", role: "context", label: "Compaction summary", text: "Summary" },
    { ...abort, id: "abort" }, failure(),
  ];
  const pending = { ...call, id: "pending", text: "Streaming reply" };
  const rows = transcriptRows(history, { pending, showTools: false });
  assert.deepEqual(ids(rows), ["user", "abort", "error"]);
  // The tool activity that would explain the abort is hidden, so the abort itself shows.
  assert.equal(reply(rows, "abort").error?.summary, "This operation was aborted");
  for (const row of rows) if (row.kind === "reply") assert.deepEqual([row.text, row.tools], ["", []]);
  assert.deepEqual(transcriptRows([call], { pending: call, showTools: false }), []);
  // With tools shown, the failed call already says it was aborted.
  assert.deepEqual(ids(transcriptRows(history, { pending })), ["user", "call", "orphan", "context", "error", "pending"]);
});

test("both displays list every Jump to destination as a row, and messages-only lists nothing else", () => {
  const history: RenderMsg[] = [
    { id: "user", role: "user", text: "My question" },
    { id: "commentary", role: "assistant", text: "Intermediate commentary" },
    call, result,
    { id: "final", role: "assistant", text: "Final answer" },
    { id: "image", role: "user", text: "", attachments: [{ kind: "image", url: "data:image/png;base64,abc" }] },
    { id: "next", role: "assistant", text: "Next final answer" },
  ];
  const destinations = ["user", "final", "image", "next"];
  assert.deepEqual(jumps(history).flatMap(entry => "messageId" in entry ? [entry.messageId] : []), destinations);
  assert.deepEqual(ids(transcriptRows(history, { showTools: false })), destinations);
  const all = transcriptRows(history, { pending: { id: "pending", role: "assistant", text: "Unfinished reply" } });
  assert.deepEqual(all.flatMap(row => "jump" in row && row.jump ? [row.msg.id] : []), destinations, "a pending reply is never a destination");
});

test("summarization retains exact raw details and safely falls back for unknown payloads", () => {
  const present = (raw: string) => messageError(failure(raw), [], new Map(), {});
  assert.deepEqual(present(apiError), { summary: "The usage limit has been reached", details: apiError });
  const nested = 'provider API error (500): {"error":{"message":"Try again later"}}';
  assert.deepEqual(present(nested), { summary: "Try again later", details: nested });
  for (const raw of ["Connection refused", "provider API error (500): {broken", 'provider API error (500): {"message":42}', 'provider API error (500): null']) {
    assert.deepEqual(present(raw), { summary: raw });
  }
  const long = `Provider failed: ${"details ".repeat(100)}`;
  assert.equal(present(long)?.details, long);
  assert.ok(present(long)!.summary.length <= 240);
});
