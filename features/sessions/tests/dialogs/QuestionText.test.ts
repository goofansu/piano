import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { Tooltip } from "@base-ui/react/tooltip";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vite } from "../../../../test/shared/vite.ts";

const { QuestionText } = (await vite.ssrLoadModule(
  path.resolve("features/sessions/web/dialogs/QuestionText.tsx"),
)) as {
  QuestionText: ComponentType<{ text: string }>;
};
const renderQuestion = (text: string) =>
  renderToStaticMarkup(
    createElement(Tooltip.Provider, null, createElement(QuestionText, { text })),
  );

test("a question keeps its single line breaks for the browser to show", () => {
  const html = renderQuestion(
    "Confirm deployment?\nWorkflow: CN Production\nBranch: feature/new-form-ui",
  );
  assert.match(
    html,
    /<p>Confirm deployment\?\nWorkflow: CN Production\nBranch: feature\/new-form-ui<\/p>/,
  );
  assert.match(html, /\[&amp;_p\]:whitespace-pre-line/);
});

test("a question's Markdown renders as prose: emphasis, lists and links", () => {
  const html = renderQuestion(
    "Deploy **cn-production**?\n\n- Run: [latest](https://example.test/runs/1)\n- Target: `cn-production`",
  );
  assert.match(html, /class="[^"]*prose-chat/);
  assert.match(html, /<strong>cn-production<\/strong>/);
  assert.match(
    html,
    /<ul>[\s\S]*<li>Run: <a [^>]*href="https:\/\/example.test\/runs\/1"[^>]*>latest<\/a><\/li>/,
  );
  assert.match(html, /<code>cn-production<\/code>/);
  assert.ok(!html.includes("**"));
});

test("a question's raw HTML stays inert text", () => {
  const html = renderQuestion("Allow <script>alert(1)</script>?");
  assert.ok(!html.includes("<script>"));
});
