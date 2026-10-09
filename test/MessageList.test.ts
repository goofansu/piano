import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import type { RenderMsg, ToolExecution } from "../shared/wire.ts";
import { messageError } from "../web/src/lib/messageError.ts";

// Load the real TSX component through the application's existing Vite transform.
const vite = await createServer({ root: path.resolve("web"), server: { middlewareMode: true, watch: null }, appType: "custom" });
after(() => vite.close());
const { MessageList } = await vite.ssrLoadModule("/src/components/MessageList.tsx") as {
  MessageList: ComponentType<{ messages: RenderMsg[]; pending: RenderMsg | null; tools: Record<string, ToolExecution>; showTools?: boolean }>;
};
const render = (messages: RenderMsg[], tools: Record<string, ToolExecution> = {}, pending: RenderMsg | null = null, showTools = true) =>
  renderToStaticMarkup(createElement(MessageList, { messages, tools, pending, showTools }));
const apiError = 'exe-dev-openai API error (429): {"type":"usage_limit_reached","message":"The usage limit has been reached","retry_after":123}';
const failure = (errorMessage = apiError): RenderMsg => ({ id: "error", role: "assistant", text: "", stopReason: "error", errorMessage });
const call: RenderMsg = { id: "call", role: "assistant", text: "", toolCalls: [{ id: "sleep", name: "bash", args: '{"command":"sleep 30"}' }] };
const result: RenderMsg = { id: "result", role: "tool_result", toolCallId: "sleep", text: "Command aborted", isError: true };
const abort = failure("This operation was aborted");

test("API errors render as concise standalone errors with details available on demand", () => {
  const html = render([failure()]);
  assert.match(html, />The usage limit has been reached</);
  assert.match(html, /Error details/);
  assert.doesNotMatch(html, /<article|data-slot="alert"|error: exe-dev-openai/);
  assert.doesNotMatch(html, /retry_after/, "raw JSON is not expanded by default");
  const partial = render([{ ...failure(), text: "Partial answer" }]);
  assert.match(partial, /Partial answer/);
  assert.ok(partial.indexOf("</article>") < partial.indexOf('role="alert"'), "an error is a sibling, not nested in the partial reply");
});

test("a failed aborted tool replaces only the duplicated abort, including pending and reload views", () => {
  for (const html of [render([call, result, abort]), render([call, result], {}, abort), render([{ ...call, ...abort, toolCalls: call.toolCalls }, result])]) {
    assert.match(html, />Failed</);
    assert.doesNotMatch(html, /This operation was aborted/);
  }
  const execution: ToolExecution = { id: "sleep", name: "bash", args: call.toolCalls![0]!.args, text: "Command aborted", status: "error", outputKind: "final" };
  assert.doesNotMatch(render([call, abort], { sleep: execution }), /This operation was aborted/);
  const pendingCall = render([], { sleep: execution }, { ...call, ...abort, toolCalls: call.toolCalls });
  assert.match(pendingCall, />Failed</);
  assert.doesNotMatch(pendingCall, /This operation was aborted/);
});

test("unrelated genuine errors and unrepresented aborts remain visible", () => {
  assert.match(render([call, result, failure()]), /The usage limit has been reached/);
  assert.match(render([abort]), /This operation was aborted/);
  assert.match(render([call, { ...result, text: "Permission denied" }, abort]), /This operation was aborted/);
  assert.match(render([call, { ...result, isError: false }, abort]), /This operation was aborted/);
  assert.match(render([call, result, { id: "next", role: "user", text: "Next turn" }, abort]), /This operation was aborted/);
  assert.match(render([call, result, { id: "reply", role: "assistant", text: "Continuing" }, abort]), /This operation was aborted/);
  assert.match(render([call, result, failure("The operation was aborted because credentials expired")]), /credentials expired/);
  assert.match(render([call, { ...result, toolCallId: "unrelated" }, abort]), /This operation was aborted/);
});

test("messages-only hides historical, orphan and streaming tools but retains prose and errors", () => {
  const history: RenderMsg[] = [
    { id: "user", role: "user", text: "My question" },
    { ...call, text: "Partial reply" }, result,
    { id: "orphan", role: "tool_result", toolName: "read", text: "Hidden tool output" },
    abort, failure(),
  ];
  const pending = { ...call, id: "pending", text: "Streaming reply" };
  const html = render(history, {}, pending, false);
  for (const text of ["My question", "Partial reply", "Streaming reply", "This operation was aborted", "The usage limit has been reached"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /sleep 30|Hidden tool output|data-tools-only=""|data-ends-with-tools=""|>Failed</);
  assert.doesNotMatch(render([call], {}, call, false), /<article/);
  assert.match(render(history, {}, pending), /sleep 30/);
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
  const unsafe = 'provider API error (400): {"message":"<script>alert(1)</script>"}';
  assert.match(render([failure(unsafe)]), /&lt;script&gt;/);
  assert.doesNotMatch(render([failure(unsafe)]), /<script>/);
});
