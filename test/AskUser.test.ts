import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import pianoAskUser from "../extensions/piano-ask-user/index.ts";

function tool() {
  let registered: ToolDefinition | undefined;
  pianoAskUser({
    registerTool: (definition: ToolDefinition) => {
      registered = definition;
    },
  } as ExtensionAPI);
  assert.ok(registered);
  return registered;
}

const context = (editor: (title: string) => Promise<string | undefined>, hasUI = true) =>
  ({ hasUI, ui: { editor } }) as unknown as ExtensionToolContext;
const question = { id: "requirements", question: "What should change?" };

test("ask_user preserves empty and multiline replies, and distinguishes cancellation", async () => {
  const ask = tool();
  for (const answer of ["", "First line\nSecond line", undefined]) {
    const result = await ask.execute(
      "question",
      { questions: [question] },
      undefined,
      undefined,
      context(async (title) => {
        assert.equal(title, "What should change?", "single questions need no progress prefix");
        return answer;
      }),
    );
    const expected =
      answer === undefined
        ? { status: "cancelled", answers: {} }
        : { status: "answered", answers: { requirements: answer } };
    assert.deepEqual(result.details, expected);
    assert.deepEqual(result.structuredContent, expected);
    assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(expected) }]);
  }
});

test("ask_user numbers a batch and cancellation keeps submitted answers without opening the rest", async () => {
  const titles: string[] = [];
  const result = await tool().execute(
    "batch",
    {
      questions: [
        question,
        { id: "schedule", question: "When?" },
        { id: "scope", question: "Scope?" },
      ],
    },
    undefined,
    undefined,
    context(async (title) => {
      titles.push(title);
      return titles.length === 1 ? "Keep the API" : undefined;
    }),
  );
  assert.deepEqual(titles, ["1 of 3: What should change?", "2 of 3: When?"]);
  assert.deepEqual(result.details, {
    status: "cancelled",
    answers: { requirements: "Keep the API" },
  });
});

test("ask_user treats question IDs as data, including object property names", async () => {
  const result = await tool().execute(
    "keys",
    { questions: ["__proto__", "constructor"].map((id) => ({ id, question: "Value?" })) },
    undefined,
    undefined,
    context(async () => "submitted"),
  );
  const expected = JSON.parse(
    '{"status":"answered","answers":{"__proto__":"submitted","constructor":"submitted"}}',
  );
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(expected) }]);
});

test("ask_user never accepts a reply racing abort or opens a pre-aborted question", async () => {
  const ask = tool();
  const controller = new AbortController();
  let opened = 0;
  const result = await ask.execute(
    "question",
    {
      questions: [
        question,
        { id: "continue", question: "Continue?" },
        { id: "later", question: "Later?" },
      ],
    },
    controller.signal,
    undefined,
    context(async () => {
      if (++opened === 1) return "Keep the API";
      controller.abort();
      return "yes";
    }),
  );
  assert.equal(opened, 2);
  assert.deepEqual(result.details, {
    status: "cancelled",
    answers: { requirements: "Keep the API" },
  });
  const again = await ask.execute(
    "cancelled",
    { questions: [question] },
    controller.signal,
    undefined,
    context(async () => assert.fail("A pre-aborted call must not open a dialog")),
  );
  assert.deepEqual(again.details, { status: "cancelled", answers: {} });
});

test("ask_user validates the whole batch before opening a dialog and requires a UI", async () => {
  const ask = tool();
  const ctx = context(async () => assert.fail("Invalid requests must not open a dialog"));
  for (const questions of [
    [],
    [question, { ...question, id: " " }],
    [question, { id: "next", question: "  " }],
    [question, { id: "next", question: "Choose", options: [" "] }],
    [question, { ...question }],
  ])
    await assert.rejects(
      ask.execute("invalid", { questions }, undefined, undefined, ctx),
      /required|blank|unique/,
    );
  await assert.rejects(
    ask.execute("headless", { questions: [question] }, undefined, undefined, {
      ...ctx,
      hasUI: false,
    }),
    /interactive UI/,
  );
});
