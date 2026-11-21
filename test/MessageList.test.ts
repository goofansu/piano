import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, type ComponentType, type Context, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import type { RenderMsg, ToolExecution } from "../shared/wire.ts";
import {
  createTranscriptProjector,
  jumpEntries,
} from "../web/src/features/transcript/transcript.ts";
import type { PageStores } from "../web/src/lib/pageStores.ts";
import { pageStores } from "./fixtures/pageStores.ts";

const vite = await createServer({
  root: path.resolve("web"),
  server: { middlewareMode: true, watch: null },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => vite.close());
const { Transcript, TranscriptProvider } = (await vite.ssrLoadModule(
  "/src/features/transcript/index.ts",
)) as {
  Transcript: ComponentType<{ activity?: "starting" | "working" }>;
  TranscriptProvider: ComponentType<{
    messages: readonly RenderMsg[];
    pending: RenderMsg | null;
    tools?: readonly ToolExecution[];
    showTools?: boolean;
    working?: boolean;
    children?: ReactNode;
  }>;
};
const { PageStoresContext } = (await vite.ssrLoadModule("/src/lib/usePageStores.ts")) as {
  PageStoresContext: Context<PageStores | null>;
};
const render = (
  messages: RenderMsg[],
  tools: Record<string, ToolExecution> = {},
  pending: RenderMsg | null = null,
  showTools = true,
  working = false,
) =>
  renderToStaticMarkup(
    createElement(
      PageStoresContext.Provider,
      { value: pageStores() },
      createElement(
        TranscriptProvider,
        { messages, tools: Object.values(tools), pending, showTools, working },
        createElement(Transcript, { activity: working ? "working" : undefined }),
      ),
    ),
  );
test("unchanged saved history is not reread when empty executions are supplied again", async (t) => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  let reads = 0;
  const messages: RenderMsg[] = [
    {
      id: "saved",
      role: "user",
      get text() {
        reads++;
        return "Saved question";
      },
    },
  ];
  const renderProvider = async (tools?: ToolExecution[]) => {
    await act(() =>
      root.render(createElement(TranscriptProvider, { messages, pending: null, tools })),
    );
  };
  await renderProvider([]);
  assert.ok(reads > 0, "the initial history was projected");
  const initial = reads;
  await renderProvider([]);
  assert.equal(reads, initial, "an empty execution list must not reproject unchanged history");
  await renderProvider();
  assert.equal(reads, initial, "absent saved executions mean the same empty input");
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

test("saved and streaming assistant images retain file-preview fallback actions", () => {
  const image: RenderMsg = {
    id: "image",
    role: "assistant",
    text: "Before ![Input](.scratch/inline-questions/pr-journey/01-input.png) after.",
  };
  for (const html of [render([image]), render([], {}, image)]) {
    assert.match(html, /data-local-file=".scratch\/inline-questions\/pr-journey\/01-input.png"/);
    assert.match(html, />Input<\/button>/);
    assert.ok(html.indexOf("Before") < html.indexOf("data-local-file"));
    assert.ok(html.indexOf("data-local-file") < html.indexOf("after."));
    assert.doesNotMatch(html, /<img|href=/, "no unchecked resource URL while loading");
  }
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
    for (const entry of jumpEntries(createTranscriptProjector()(history).history))
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
    render(messages, {}, pending, showTools, true);
  assert.doesNotMatch(working(history), /Let me investigate/);
  assert.deepEqual(
    jumpEntries(createTranscriptProjector()(history, { working: true }).history).flatMap((entry) =>
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
  assert.match(working([user, final, { ...user, id: "next" }]), /Final answer/);
});

test("error summaries render as text, never markup", () => {
  const unsafe = 'provider API error (400): {"message":"<script>alert(1)</script>"}';
  const html = render([failure(unsafe)]);
  assert.ok(html.includes("&lt;script&gt;"), "the summary's markup is escaped");
  assert.ok(!html.toLowerCase().includes("<script"), "no script element is rendered");
});

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
    body,
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
      id: "status",
      role: "assistant",
      text: "",
      toolCalls: [{ id: "s", name: "piano_session_status", args: '{"sessionId":"s1"}' }],
    },
  ]);
  const context = fold(html, "Shell");
  const skill = fold(html, "review skill");
  const tool = fold(html, "bash tool call");
  const bare = fold(html, "Dispatched session: Session");
  for (const row of [context, skill, tool, bare]) {
    assert.match(row.header, /data-sidebar-swipe="true"/);
    assert.equal(row.chevron, row.canOpen, "a chevron exactly when the row can open");
  }
  assert.match(tool.header, /data-slot="gutter"/, "the tool gutter is part of its button");
  assert.deepEqual(
    [context, skill, tool].map((row) => [row.open, row.canOpen, !!row.body]),
    [
      [true, true, true],
      [false, true, false],
      [false, true, false],
    ],
    "context starts open; a skill and a tool start closed and render no body",
  );
  assert.match(context.markup, /data-slot="collapsible-content".*shell says hi/s);
  assert.equal(bare.canOpen, false, "a card without details cannot open");
  assert.equal(bare.body, undefined, "a card without details has no body");
  assert.doesNotMatch(html, /tool output text/, "a closed body renders nothing");
  assert.match(html, /<article[^>]*>(?:(?!<\/article>).)*aria-label="review skill"/s);
  assert.doesNotMatch(
    skill.markup.slice(0, skill.markup.indexOf(skill.header)),
    /data-slot="gutter"/,
  );
});
