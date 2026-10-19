import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../web/src/lib/markdown.ts";

test("GitHub issue, PR and repository links are compact without changing destinations or custom labels", () => {
  const url = "https://github.com/goofansu/herdr-hunk/issues/2?x=1&y=2#issuecomment-3";
  const html = renderMarkdown(
    `Follow ${url}, then [#3799](https://github.com/example/herdr/pull/3799). [**Review**](https://github.com/example/herdr/pull/4) <https://github.com/example/herdr>`,
  );
  assert.equal((html.match(/class="brand-link"/g) ?? []).length, 4);
  assert.ok(
    html.includes(
      'href="https://github.com/goofansu/herdr-hunk/issues/2?x=1&amp;y=2#issuecomment-3"',
    ),
  );
  assert.ok(
    html.includes(
      'title="https://github.com/goofansu/herdr-hunk/issues/2?x=1&amp;y=2#issuecomment-3"',
    ),
  );
  assert.ok(html.includes("</svg>herdr-hunk#2</a>,"));
  assert.ok(html.includes("</svg>#3799</a>"));
  assert.ok(html.includes("</svg><strong>Review</strong></a>"));
  assert.ok(html.includes("</svg>example/herdr</a>"));
  assert.ok(
    renderMarkdown(`[https://github.com/a/b/pull/1](https://github.com/a/b/pull/1)`).includes(
      "</svg>b#1</a>",
    ),
  );
  assert.ok(
    renderMarkdown("[`code`](https://github.com/a/b/issues/1)").includes(
      "</svg><code>code</code></a>",
    ),
  );
});

test("GitHub rendering leaves code and unrelated URLs alone and escapes untrusted input", () => {
  const url = "https://github.com/a/b/issues/1";
  const code = renderMarkdown(`\`${url}\`\n\n\`\`\`\n${url}\n\`\`\``);
  assert.ok(!code.includes("<a"));
  for (const other of [
    "https://example.test/a",
    "https://github.com.evil.test/a/b/issues/1",
    "https://github.com@evil.test/a/b/issues/1",
    "https://user@github.com/a/b/issues/1",
  ]) {
    assert.equal(renderMarkdown(other), `<p>${other}</p>`);
    assert.ok(!renderMarkdown(`[link](${other})`).includes("brand-link"));
  }
  const html = renderMarkdown(
    '[<img src=x onerror=alert>](https://github.com/a/b/issues/1?x="onclick="bad)',
  );
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&quot;onclick=&quot;bad"));
  assert.ok(!html.includes('"onclick="'));
  assert.ok(!renderMarkdown(`[javascript](javascript:alert(1))`).includes("<a"));
});

test("a bold or italic bare URL links without its emphasis markers", () => {
  const html = renderMarkdown(
    "See **https://github.com/a/b/pull/7** and *https://github.com/a/b*.",
  );
  assert.ok(html.includes('<strong><a href="https://github.com/a/b/pull/7"'), html);
  assert.ok(html.includes("b#7</a></strong>"), html);
  assert.ok(html.includes("a/b</a></em>."), html);
});

test("Linear links reuse the MCP logo and preserve destinations and labels", () => {
  const url = "https://linear.app/team/issue/ENG-42/fix?x=1&y=2#comment";
  const html = renderMarkdown(`${url}, [**Fix**](${url}) <${url}>`);
  assert.equal((html.match(/class="brand-link"/g) ?? []).length, 3);
  assert.equal((html.match(/href="\/mcp-logos.svg#linear"/g) ?? []).length, 3);
  assert.ok(html.includes(`href="${url.replaceAll("&", "&amp;")}"`));
  assert.ok(html.includes(`title="${url.replaceAll("&", "&amp;")}"`));
  assert.ok(html.includes("</svg><strong>Fix</strong></a>"));
  assert.ok(html.includes("#comment</a>,"));
  assert.ok(!renderMarkdown(`\`${url}\`\n\n\`\`\`\n${url}\n\`\`\``).includes("<a"));
  for (const other of [
    "https://linear.app.evil.test/team/issue/ENG-42",
    "https://linear.app@evil.test/team/issue/ENG-42",
    "https://user@linear.app/team/issue/ENG-42",
    "https://linear.app:8080/team/issue/ENG-42",
  ]) {
    assert.equal(renderMarkdown(other), `<p>${other}</p>`);
    assert.ok(!renderMarkdown(`[link](${other})`).includes("brand-link"));
  }
});

test("local Markdown links are preview actions, never filesystem HTTP URLs", () => {
  for (const [destination, path] of [
    ["src/main.ts", "src/main.ts"],
    ["./docs/guide.md#intro", "./docs/guide.md"],
    ["../notes.txt", "../notes.txt"],
    ["/workspace/README.md", "/workspace/README.md"],
    ["docs/my%20notes.md", "docs/my notes.md"],
    ["docs/a(b).md", "docs/a(b).md"],
    ["file:///workspace/README.md", "/workspace/README.md"],
  ]) {
    const html = renderMarkdown(`Read [\`source\`](${destination}).`);
    assert.ok(html.includes(`data-local-file="${path}"`), destination);
    assert.ok(html.includes("<code>source</code></button>"));
    assert.ok(!html.includes("href="), "paths never become browser navigation URLs");
  }
  assert.ok(!renderMarkdown("`[source](src/main.ts)`").includes("data-local-file"));
  assert.ok(!renderMarkdown("```\n[source](src/main.ts)\n```").includes("data-local-file"));
});

test("local file links escape markup and do not turn schemes or remote hosts into file reads", () => {
  for (const destination of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "mailto:a@b.test",
    "//example.test/a",
    "file://other-host/a",
    "#heading",
    "bad%ZZ",
    "bad%00path",
  ]) {
    const html = renderMarkdown(`[source](${destination})`);
    assert.ok(!html.includes("data-local-file"), destination);
    assert.ok(!html.includes("<a"), destination);
  }
  const html = renderMarkdown("[<img src=x>](docs/a%22onclick=%22bad.txt)");
  assert.ok(html.includes('data-local-file="docs/a&quot;onclick=&quot;bad.txt"'));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('"onclick="'));
  assert.ok(
    renderMarkdown("[site](https://example.test/readme.md)").includes(
      'href="https://example.test/readme.md" target="_blank"',
    ),
  );
});

test("document images are scoped placeholders, never active or external resource URLs", () => {
  const html = renderMarkdown(
    "![Local](../a%20b.png) ![Remote](https://example.test/x.png) ![Data](data:image/png;base64,abc) <img src=x onerror=bad>",
    true,
  );
  assert.ok(html.includes('data-local-image="../a b.png"'));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("src=" + '"'));
  assert.equal((html.match(/data-local-image=/g) ?? []).length, 1);
  for (const source of ["`![code](a.png)`", "```\n![code](a.png)\n```"])
    assert.ok(!renderMarkdown(source, true).includes("data-local-image"));
  assert.ok(
    !renderMarkdown("![Local](a.png)").includes("data-local-image"),
    "transcripts do not acquire embedded files",
  );
});

test("ordered lists continue across blank lines and retain their starting number", () => {
  assert.equal(
    renderMarkdown(
      "1. **Yes**\n\n2. Link is accurate\n\n3. Hide the control\n\nFollowing paragraph.",
    ),
    "<ol><li><strong>Yes</strong></li><li>Link is accurate</li><li>Hide the control</li></ol><p>Following paragraph.</p>",
  );
  assert.equal(
    renderMarkdown("4. Fourth\n\n5. Fifth"),
    '<ol start="4"><li>Fourth</li><li>Fifth</li></ol>',
  );
  // Markdown takes the first marker as the start; repeated 1s still form a numbered list.
  assert.equal(renderMarkdown("1. First\n\n1. Second"), "<ol><li>First</li><li>Second</li></ol>");
  assert.equal(
    renderMarkdown("1. First\n\nSeparate paragraph\n\n3. Third"),
    '<ol><li>First</li></ol><p>Separate paragraph</p><ol start="3"><li>Third</li></ol>',
  );
  assert.equal(
    renderMarkdown("1. First\n\n- Bullet\n\n2. Second"),
    '<ol><li>First</li></ol><ul><li>Bullet</li></ul><ol start="2"><li>Second</li></ol>',
  );
});

test("consecutive quoted lines form one quote, including blank lines and lists", () => {
  assert.equal(
    renderMarkdown("> Added a copy button.\n>\n> Copies code.\n> Shows a checkmark.\n\nMy reply."),
    "<blockquote><p>Added a copy button.</p><p>Copies code.<br>Shows a checkmark.</p></blockquote><p>My reply.</p>",
  );
  assert.equal(
    renderMarkdown("> Features:\n>\n> - Copy\n> - Confirm\n\n> Another quote"),
    "<blockquote><p>Features:</p><ul><li>Copy</li><li>Confirm</li></ul></blockquote><blockquote><p>Another quote</p></blockquote>",
  );
  assert.equal(
    renderMarkdown("```\n> not a quote\n```\n> ```html\n> <script>\n> ```"),
    "<pre><code>&gt; not a quote</code></pre><blockquote><pre><code>&lt;script&gt;</code></pre></blockquote>",
  );
});

test("only closed Mermaid fences are eligible for diagram rendering", () => {
  assert.equal(
    renderMarkdown("```mermaid\ngraph LR\nA-->B"),
    "<pre><code>graph LR\nA--&gt;B</code></pre>",
  );
  assert.equal(
    renderMarkdown("```mermaid\ngraph LR\nA-->B\n```"),
    '<pre data-mermaid=""><code>graph LR\nA--&gt;B</code></pre>',
  );
  assert.equal(
    renderMarkdown("```js\n<script>alert(1)</script>\n```"),
    "<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>",
  );
  assert.ok(!renderMarkdown('<pre data-mermaid="">bad</pre>').includes("<pre"));
});

test("Mermaid source stays escaped and surrounding Markdown keeps its order", () => {
  const html = renderMarkdown(
    '| Before |\n| --- |\n| table |\n```mermaid\ngraph LR\nA["<img src=x onerror=alert(1)>"]\n```\n\nAfter',
  );
  assert.ok(html.indexOf("</table>") < html.indexOf("<pre data-mermaid"));
  assert.ok(html.endsWith("</code></pre><p>After</p>"));
  assert.ok(!html.includes("<img"));
});
