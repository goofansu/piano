import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../web/src/lib/markdown.ts";

test("only closed Mermaid fences are eligible for diagram rendering", () => {
  assert.equal(renderMarkdown("```mermaid\ngraph LR\nA-->B"), "<pre><code>graph LR\nA--&gt;B</code></pre>");
  assert.equal(renderMarkdown("```mermaid\ngraph LR\nA-->B\n```"), '<pre data-mermaid=""><code>graph LR\nA--&gt;B</code></pre>');
  assert.equal(renderMarkdown("```js\n<script>alert(1)</script>\n```"), "<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>");
  assert.ok(!renderMarkdown('<pre data-mermaid="">bad</pre>').includes('<pre'));
});

test("file links become browser-handled controls only when explicitly enabled", () => {
  const source = "[Open notes](file:///Users/test/Downloads/notes%20one.md) [Web](https://example.test)";
  const plain = renderMarkdown(source);
  assert.match(plain, /\[Open notes\]\(file:\/\/\/Users\/test\/Downloads\/notes%20one\.md\)/);
  assert.ok(!plain.includes("data-file-href"));
  assert.match(plain, /<a href="https:\/\/example\.test" target="_blank" rel="noreferrer">Web<\/a>/);

  const enabled = renderMarkdown(source, { fileLinks: true });
  assert.match(enabled, /<a href="#" data-file-href="file:\/\/\/Users\/test\/Downloads\/notes%20one\.md">Open notes<\/a>/);
  assert.ok(!/<a href="file:/.test(enabled));
});

test("Mermaid source stays escaped and surrounding Markdown keeps its order", () => {
  const html = renderMarkdown('| Before |\n| --- |\n| table |\n```mermaid\ngraph LR\nA["<img src=x onerror=alert(1)>"]\n```\n\nAfter');
  assert.ok(html.indexOf('</table>') < html.indexOf('<pre data-mermaid'));
  assert.ok(html.endsWith('</code></pre><p>After</p>'));
  assert.ok(!html.includes('<img'));
});
