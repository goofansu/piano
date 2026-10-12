import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import type { RenderMsg, ToolExecution } from "../shared/wire.ts";
import { jumpEntries, transcriptRows } from "../web/src/lib/transcript.ts";

// Load the real TSX component through the application's existing Vite transform.
const vite = await createServer({
  root: path.resolve("web"),
  server: { middlewareMode: true, watch: null },
  appType: "custom",
});
after(() => vite.close());
const { MessageList } = (await vite.ssrLoadModule("/src/components/MessageList.tsx")) as {
  MessageList: ComponentType<{
    messages: RenderMsg[];
    pending: RenderMsg | null;
    tools: Record<string, ToolExecution>;
    showTools?: boolean;
  }>;
};
const render = (
  messages: RenderMsg[],
  tools: Record<string, ToolExecution> = {},
  pending: RenderMsg | null = null,
  showTools = true,
) => renderToStaticMarkup(createElement(MessageList, { messages, tools, pending, showTools }));
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

test("API errors render as concise standalone errors with details available on demand", () => {
  const html = render([failure()]);
  assert.match(html, />The usage limit has been reached</);
  assert.match(html, /Error details/);
  assert.doesNotMatch(html, /<article|data-slot="alert"|error: exe-dev-openai/);
  assert.doesNotMatch(html, /retry_after/, "raw JSON is not expanded by default");
  const partial = render([{ ...failure(), text: "Partial answer" }]);
  assert.match(partial, /Partial answer/);
  assert.ok(
    partial.indexOf("</article>") < partial.indexOf('role="alert"'),
    "an error is a sibling, not nested in the partial reply",
  );
});

test("a represented abort renders as the failed tool alone", () => {
  const html = render([call, result, abort]);
  assert.match(html, />Failed</);
  assert.doesNotMatch(html, /This operation was aborted|role="alert"/);
});

test("messages-only renders no tool activity, and every Jump to destination has its anchor", () => {
  const history: RenderMsg[] = [
    { id: "user", role: "user", text: "My question" },
    { ...call, text: "Partial reply" },
    result,
    { id: "orphan", role: "tool_result", toolName: "read", text: "Hidden tool output" },
    abort,
    { id: "final", role: "assistant", text: "Final answer" },
  ];
  const html = render(history, {}, { ...call, id: "pending", text: "Streaming reply" }, false);
  assert.doesNotMatch(
    html,
    /Partial reply|Streaming reply|sleep 30|Hidden tool output|data-tools-only=""|data-ends-with-tools=""|>Failed</,
  );
  assert.match(html, /This operation was aborted/);
  for (const showTools of [true, false]) {
    const shown = render(history, {}, null, showTools);
    for (const entry of jumpEntries(transcriptRows(history)))
      if ("messageId" in entry)
        assert.ok(shown.includes(`id="msg-${entry.messageId}"`), entry.messageId);
    assert.equal(
      (shown.match(/aria-label="Copy response"/g) ?? []).length,
      1,
      "copy only on the final reply",
    );
    assert.match(shown, /id="msg-final".*?aria-label="Copy response"/s);
  }
});

test("error summaries render as text, never markup", () => {
  const unsafe = 'provider API error (400): {"message":"<script>alert(1)</script>"}';
  assert.match(render([failure(unsafe)]), /&lt;script&gt;/);
  assert.doesNotMatch(render([failure(unsafe)]), /<script>/);
});
