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

const context = (editor: () => Promise<string | undefined>, hasUI = true) =>
  ({ hasUI, ui: { editor } }) as unknown as ExtensionToolContext;

test("ask_user preserves empty and multiline replies, and distinguishes cancellation", async () => {
  const ask = tool();
  for (const answer of ["", "First line\nSecond line", undefined]) {
    const result = await ask.execute(
      "question",
      { question: "What should change?" },
      undefined,
      undefined,
      context(async () => answer),
    );
    const expected =
      answer === undefined ? { status: "cancelled" } : { status: "answered", answer };
    assert.deepEqual(result.details, expected);
    assert.deepEqual(result.structuredContent, expected);
    assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(expected) }]);
  }
});

test("ask_user never accepts a reply racing abort or opens a pre-aborted question", async () => {
  const ask = tool();
  const controller = new AbortController();
  const result = await ask.execute(
    "question",
    { question: "Continue?" },
    controller.signal,
    undefined,
    context(async () => {
      controller.abort();
      return "yes";
    }),
  );
  assert.deepEqual(result.details, { status: "cancelled" });
  const again = await ask.execute(
    "cancelled",
    { question: "Continue?" },
    controller.signal,
    undefined,
    context(async () => assert.fail("A pre-aborted call must not open a dialog")),
  );
  assert.deepEqual(again.details, { status: "cancelled" });
});

test("ask_user fails explicitly without a UI or with blank question/choice text", async () => {
  const ask = tool();
  const ctx = context(async () => assert.fail("Invalid requests must not open a dialog"));
  for (const params of [{ question: "  " }, { question: "Choose", options: [" "] }])
    await assert.rejects(ask.execute("invalid", params, undefined, undefined, ctx), /blank/);
  await assert.rejects(
    ask.execute("headless", { question: "Choose" }, undefined, undefined, { ...ctx, hasUI: false }),
    /interactive UI/,
  );
});
