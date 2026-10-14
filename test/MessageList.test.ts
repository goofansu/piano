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
    activity?: "starting" | "working";
    working?: boolean;
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

test("messages-only never flashes a completed intermediate message while the agent is working", () => {
  const user: RenderMsg = { id: "user", role: "user", text: "My question" };
  const commentary: RenderMsg = { id: "commentary", role: "assistant", text: "Let me investigate" };
  const final: RenderMsg = { id: "final", role: "assistant", text: "Final answer" };
  const history = [user, commentary];
  const working = (messages: RenderMsg[], pending: RenderMsg | null = null, showTools = false) =>
    renderToStaticMarkup(
      createElement(MessageList, {
        messages,
        pending,
        tools: {},
        showTools,
        activity: "working",
        working: true,
      }),
    );
  // message_end can arrive before the next message_start, with no pending message.
  assert.doesNotMatch(working(history), /Let me investigate/);
  assert.deepEqual(
    jumpEntries(transcriptRows(history, { working: true })).flatMap((entry) =>
      "messageId" in entry ? [entry.messageId] : [],
    ),
    ["user"],
    "the jump list must not leak commentary or target a hidden reply",
  );
  assert.doesNotMatch(working(history, call), /Let me investigate/);
  assert.doesNotMatch(
    working([...history, call, result, final]),
    /Let me investigate|Final answer/,
  );
  assert.match(working(history, null, true), /Let me investigate/);
  const settled = render([...history, call, result, final], {}, null, false);
  assert.doesNotMatch(settled, /Let me investigate/);
  assert.match(settled, /Final answer/);
  assert.match(working([...history, failure()]), /The usage limit has been reached/);
  // Starting a new turn must not hide a previous turn's answer.
  assert.match(working([user, final, { ...user, id: "next" }]), /Final answer/);
});

test("error summaries render as text, never markup", () => {
  const unsafe = 'provider API error (400): {"message":"<script>alert(1)</script>"}';
  assert.match(render([failure(unsafe)]), /&lt;script&gt;/);
  assert.doesNotMatch(render([failure(unsafe)]), /<script>/);
});

/** One folding row's markup, from its group to the next folding row. */
const fold = (html: string, label: string) => {
  const start = html.indexOf(`role="group" aria-label="${label}"`);
  assert.ok(start >= 0, `no folding row named ${label}`);
  const next = html.indexOf('role="group"', start + 1);
  const markup = html.slice(start, next < 0 ? undefined : next);
  const header = markup.match(
    /<button[^>]*data-slot="collapsible-trigger"[^>]*>.*?<\/button>/s,
  )?.[0];
  assert.ok(header, `${label} has no header`);
  const body = markup.match(/<div[^>]*data-slot="collapsible-content"[^>]*>/)?.[0];
  return {
    markup,
    header,
    open: /aria-expanded="true"/.test(header),
    canOpen: !/ disabled=""/.test(header),
    chevron: /lucide-chevron-right/.test(header),
    /** The body's element, rendered whenever the row can open; hidden while closed. */
    body,
    bodyHidden: body ? / hidden=""/.test(body) : undefined,
  };
};

test("every folding row folds the same way: context starts open, a card without details cannot open, a closed tool keeps its output in its body", () => {
  const html = render([
    { id: "ctx", role: "context", label: "Shell: npm test", text: "shell says hi" },
    {
      id: "skill",
      role: "user",
      text: "Focus on login.",
      skill: { name: "review", location: "/tmp/review/SKILL.md", body: "# Review" },
    },
    {
      id: "call",
      role: "assistant",
      text: "",
      toolCalls: [{ id: "t", name: "bash", args: '{"command":"npm test"}' }],
    },
    { id: "res", role: "tool_result", toolCallId: "t", text: "tool output text", isError: false },
    {
      id: "bare",
      role: "tool_result",
      text: "",
      subagent: { kind: "result", source: "tool", status: "unknown Run", attention: true },
    },
    {
      id: "answered",
      role: "context",
      text: "**Found it**",
      subagent: {
        kind: "result",
        source: "notification",
        label: "Find it",
        status: "Done",
        attention: false,
      },
    },
  ]);
  const context = fold(html, "Shell");
  const skill = fold(html, "review skill");
  const tool = fold(html, "bash tool call");
  const bare = fold(html, "Subagent result: Subagent result");
  const answered = fold(html, "Subagent result: Find it");
  // One header shape for every kind: padding out of flow, a sidebar swipe passes through it.
  for (const row of [context, skill, tool, bare, answered]) {
    assert.match(row.header, /class="-ml-2 -my-1 flex /);
    assert.match(row.header, /data-sidebar-swipe="true"/);
    assert.equal(row.chevron, row.canOpen, "a chevron exactly when the row can open");
  }
  assert.deepEqual(
    [context, skill, tool, answered].map((row) => [row.open, row.canOpen, row.bodyHidden]),
    [
      [true, true, false],
      [false, true, true],
      [false, true, true],
      [false, true, true],
    ],
    "context starts open; a skill, a tool and a subagent card start closed",
  );
  assert.match(context.markup, /data-slot="collapsible-content".*shell says hi/s);
  assert.equal(bare.canOpen, false, "a card without details cannot open");
  assert.equal(bare.body, undefined, "a card without details has no body");
  assert.doesNotMatch(html, /tool output text|Found it/, "a closed body renders nothing");
  // A skill folds inside its prompt bubble: no gutter of its own.
  assert.match(html, /<article[^>]*>(?:(?!<\/article>).)*aria-label="review skill"/s);
  assert.doesNotMatch(
    skill.markup.slice(0, skill.markup.indexOf(skill.header)),
    /data-slot="gutter"/,
  );
});
