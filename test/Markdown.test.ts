import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../web/src/lib/markdown.ts";

test("GitHub issue, PR and repository links are compact without changing destinations or custom labels", () => {
  const url = "https://github.com/goofansu/herdr-hunk/issues/2?x=1&y=2#issuecomment-3";
  const html = renderMarkdown(`Follow ${url}, then [#3799](https://github.com/example/herdr/pull/3799). [**Review**](https://github.com/example/herdr/pull/4) <https://github.com/example/herdr>`);
  assert.equal((html.match(/class="github-link"/g) ?? []).length, 4);
  assert.ok(html.includes('href="https://github.com/goofansu/herdr-hunk/issues/2?x=1&amp;y=2#issuecomment-3"'));
  assert.ok(html.includes('title="https://github.com/goofansu/herdr-hunk/issues/2?x=1&amp;y=2#issuecomment-3"'));
  assert.ok(html.includes('</svg>herdr-hunk#2</a>,'));
  assert.ok(html.includes('</svg>#3799</a>'));
  assert.ok(html.includes('</svg><strong>Review</strong></a>'));
  assert.ok(html.includes('</svg>example/herdr</a>'));
  assert.ok(renderMarkdown(`[https://github.com/a/b/pull/1](https://github.com/a/b/pull/1)`).includes('</svg>b#1</a>'));
  assert.ok(renderMarkdown('[`code`](https://github.com/a/b/issues/1)').includes('</svg><code>code</code></a>'));
});

test("GitHub rendering leaves code and unrelated URLs alone and escapes untrusted input", () => {
  const url = "https://github.com/a/b/issues/1";
  const code = renderMarkdown(`\`${url}\`\n\n\`\`\`\n${url}\n\`\`\``);
  assert.ok(!code.includes('<a'));
  for (const other of ['https://example.test/a', 'https://github.com.evil.test/a/b/issues/1', 'https://github.com@evil.test/a/b/issues/1', 'https://user@github.com/a/b/issues/1']) {
    assert.equal(renderMarkdown(other), `<p>${other}</p>`);
    assert.ok(!renderMarkdown(`[link](${other})`).includes('github-link'));
  }
  const html = renderMarkdown('[<img src=x onerror=alert>](https://github.com/a/b/issues/1?x="onclick="bad)');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&quot;onclick=&quot;bad'));
  assert.ok(!html.includes('"onclick="'));
  assert.ok(!renderMarkdown(`[javascript](javascript:alert(1))`).includes('<a'));
});

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
