import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { markdownImages, markdownLinks } from "../web/src/lib/markdown.ts";
import { renderMarkdown } from "./fixtures/markdown.ts";

// Assertions cover semantic output, not incidental Streamdown wrappers or whitespace.
test("README's tab-indented fenced commands stay inside their numbered step", () => {
  const html = renderMarkdown(readFileSync("README.md", "utf8"));
  assert.match(
    html,
    /<li>\s*<p>Install dependencies[\s\S]*?<pre><code>npm install\nnpm run build\nnpm start<\/code><\/pre>[\s\S]*?<\/li>/,
  );
  assert.ok(!html.includes("```bash"));
  const nested = "2. Install:\n\n\t```bash\n\tnpm install\n\t```\n\n3. Open.";
  for (const streaming of [false, true]) {
    const out = renderMarkdown(nested, false, streaming);
    assert.match(
      out,
      /<ol start="2">[\s\S]*?<li>[\s\S]*?<pre><code>npm install<\/code><\/pre>[\s\S]*?<\/li>/,
    );
  }
});

test("incomplete streaming formatting repairs while static files preserve literal syntax", () => {
  assert.match(renderMarkdown("Hello **world", false, true), /<strong>world<\/strong>/);
  assert.ok(renderMarkdown("Hello **world").includes("**world"));
  assert.match(
    renderMarkdown("```bash\nnpm install", false, true),
    /<pre><code>npm install<\/code><\/pre>/,
  );
});

test("excessive input falls back to readable escaped source without resource discovery", () => {
  for (const tail of [
    `${"> ".repeat(5000)}<script>&quoted`,
    "x".repeat(256 * 1024),
    "`x` ".repeat(10001),
    `|head|\n|---|\n${"|".repeat(20001)}`,
    `${"> ".repeat(30)}${"x".repeat(150000)}`,
  ]) {
    const source = `[before](https://example.test)\n\n${tail}`;
    const html = renderMarkdown(source, true);
    assert.ok(html.includes("<pre><code>[before](https://example.test)"));
    assert.ok(!html.includes("<script>"));
    assert.deepEqual(markdownLinks(source), []);
    assert.deepEqual(markdownImages(source), []);
  }
});

test("unmatched brackets remain readable and do not hide later links", () => {
  for (const size of [4000, 16000, 128000]) {
    const source = `${"[".repeat(size)}\n[ok](https://example.test)`;
    const html = renderMarkdown(source);
    assert.ok(html.includes("[".repeat(size)));
    assert.match(html, /href="https:\/\/example.test"[^>]*>ok<\/a>/);
    assert.deepEqual(markdownLinks(source), [
      { url: "https://example.test", label: "ok", kind: "markdown" },
    ]);
  }
});

test("provider links keep compact names, destinations, custom formatting and branding", () => {
  const html = renderMarkdown(
    "https://github.com/goofansu/piano/issues/2, [**Review**](https://github.com/a/b/pull/4) <https://github.com/a/b> [Fix](https://linear.app/team/issue/ENG-42)",
  );
  assert.equal((html.match(/class="brand-link"/g) ?? []).length, 4);
  assert.ok(html.includes("piano#2</a>,"));
  assert.ok(html.includes("<strong>Review</strong></a>"));
  assert.ok(html.includes("a/b</a>"));
  assert.ok(html.includes('href="/mcp-logos.svg#linear"'));
  for (const url of [
    "https://example.test/a",
    "https://github.com.evil.test/a/b",
    "https://user@github.com/a/b",
    "https://linear.app:8080/x",
    "https://linear.app@evil.test/x",
    "https://radius.earendil.com.evil.test/x",
    "https://sub.radius.earendil.com/x",
    "https://radius.earendil.com@evil.test/x",
    "https://user@radius.earendil.com/x",
    "https://user:password@radius.earendil.com/x",
    "https://radius.earendil.com:8080/x",
    "https://earendil.com/x",
  ]) {
    assert.ok(!renderMarkdown(url).includes("<a "), url);
    assert.ok(!renderMarkdown(`[label](${url})`).includes("brand-link"), url);
  }
  assert.match(
    renderMarkdown("**https://github.com/a/b/pull/7**"),
    /<strong><a [\s\S]*?b#7<\/a><\/strong>/,
  );
});

test("Radius links share provider branding without changing labels, titles or navigation", () => {
  for (const url of [
    "https://radius.earendil.com/artifacts/example?revision=2#section",
    "http://radius.earendil.com/docs",
    "https://RADIUS.EARENDIL.COM:443/docs",
    "http://radius.earendil.com:80/docs",
  ]) {
    for (const source of [url, `<${url}>`, `[**Report**](${url} "Supplied title")`]) {
      const html = renderMarkdown(source);
      assert.ok(html.includes(`href="${url}"`), source);
      assert.ok(html.includes('class="brand-link"'), source);
      assert.ok(html.includes('target="_blank" rel="noreferrer"'), source);
      assert.ok(html.includes('href="/provider-logos/radius.svg#logo"'), source);
      assert.equal((html.match(/<svg /g) ?? []).length, 1, "only the brand icon, no arrow");
      assert.ok(html.includes('aria-hidden="true" focusable="false"'), source);
      if (source.startsWith("[")) {
        assert.ok(html.includes("<strong>Report</strong></a>"));
        assert.ok(html.includes('title="Supplied title"'));
      } else {
        assert.ok(html.includes(`>${url}</a>`));
        assert.ok(html.includes(`title="${url}"`));
      }
    }
  }
  for (const url of ["ftp://radius.earendil.com/x", "//radius.earendil.com/x"]) {
    assert.ok(!renderMarkdown(`[Report](${url})`).includes("<a "), url);
  }
  for (const url of ["https://github.com/a/b", "https://linear.app/team/issue/ENG-42"]) {
    assert.ok(
      renderMarkdown(`[Report](${url} "Supplied title")`).includes('title="Supplied title"'),
    );
  }
});

test("local links are preview actions, never native filesystem URLs", () => {
  for (const [destination, path] of [
    ["src/main.ts", "src/main.ts"],
    ["./docs/guide.md#intro", "./docs/guide.md"],
    ["../notes.txt", "../notes.txt"],
    ["/workspace/README.md", "/workspace/README.md"],
    ["docs/my%20notes.md", "docs/my notes.md"],
    ["docs/a(b).md", "docs/a(b).md"],
    ["docs/100%.md", "docs/100%.md"],
    ["bad%ZZ", "bad%ZZ"],
    ["file:///workspace/README.md", "/workspace/README.md"],
  ]) {
    const html = renderMarkdown(`Read [\`source\`](${destination}).`);
    assert.ok(html.includes(`data-local-file="${path}"`), destination);
    assert.ok(html.includes("<code>source</code></button>"));
    assert.ok(!html.includes("href="));
  }
  for (const destination of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "mailto:a@b.test",
    "//example.test/a",
    "file://other-host/a",
    "#heading",
    "bad%FFpath",
    "bad%00path",
  ]) {
    const html = renderMarkdown(`[source](${destination})`);
    assert.ok(!html.includes("data-local-file"), destination);
    assert.ok(!html.includes("<a "), destination);
  }
  const html = renderMarkdown("[<img src=x>](docs/a%22onclick=%22bad.txt)");
  assert.ok(html.includes('data-local-file="docs/a&quot;onclick=&quot;bad.txt"'));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('"onclick="'));
});

test("raw HTML stays inert and images never fetch untrusted resource URLs", () => {
  const source =
    "![Local](../a%20b.png) ![Remote](https://example.test/x.png) ![Data](data:image/png;base64,abc) <img src=x onerror=bad><script>bad()</script>";
  const html = renderMarkdown(source, true);
  assert.ok(html.includes('data-local-image="../a b.png"'));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes('src="'));
  assert.deepEqual(markdownImages(source), ["../a b.png"]);
  assert.ok(!renderMarkdown("![Local](a.png)").includes("data-local-image"));
});

test("loaded local images are inline preview actions with a file action as their fallback", () => {
  const path = ".scratch/inline-questions/pr-journey/01-input.png";
  const source = `Before ![Input](${path}) after. [Source](docs/guide.md)`;
  const html = renderMarkdown(source, new Map([[path, "blob:workspace-image"]]));
  assert.match(
    html,
    /Before <span[^>]*><button[^>]*data-local-file="[^"]+"[^>]*><img[^>]*src="blob:workspace-image"[^>]*alt="Input"[^>]*\/><\/button><\/span> after\./,
  );
  assert.ok(html.includes('data-local-file="docs/guide.md"'));
  assert.ok(!html.includes("href="), "images and ordinary file links stay inside Piano");
  for (const destination of ["docs/guide.md", "https://example.test/other"]) {
    const linked = renderMarkdown(
      `[![Input](${path})](${destination})`,
      new Map([[path, "blob:workspace-image"]]),
    );
    assert.equal((linked.match(/<button/g) ?? []).length, 1, "no nested image/link controls");
    assert.ok(linked.includes(`data-local-file="${path}"`));
    assert.ok(!linked.includes("href="), "a linked image still opens its own file preview");
  }
  const fallback = renderMarkdown(source, true);
  assert.ok(fallback.includes(`data-local-file="${path}"`));
  assert.match(fallback, />Input<\/button>/);
  assert.ok(!fallback.includes("<img"));
  const remote = renderMarkdown(
    "![Remote](https://example.test/x.png)",
    new Map([["https://example.test/x.png", "blob:must-not-render"]]),
  );
  assert.ok(!remote.includes("<img"));
  assert.ok(!remote.includes("<a "));
  const linkedRemote = renderMarkdown(
    "[![Remote](https://example.test/x.png)](docs/guide.md)",
    true,
  );
  assert.ok(linkedRemote.includes('data-local-file="docs/guide.md"'));
  assert.ok(!linkedRemote.includes("<img"));
  assert.ok(
    renderMarkdown(`[![Input](${path})](docs/guide.md)`).includes(
      'data-local-file="docs/guide.md"',
    ),
    "prose without image loading keeps its original link",
  );
});

test("the image a document loads is the image it shows, whatever its name's characters", () => {
  // A stray % names itself; %XX escapes decode; spaces and Unicode survive either form.
  for (const [destination, path] of [
    ["100%.png", "100%.png"],
    ["bad%ZZ.png", "bad%ZZ.png"],
    ["<my shot.png>", "my shot.png"],
    ["my%20shot.png", "my shot.png"],
    ["é.png", "é.png"],
    ["%C3%A9.png", "é.png"],
  ]) {
    const source = `![chart](${destination}) [![linked](${destination})](https://example.test)`;
    const loaded = markdownImages(source);
    assert.deepEqual(loaded, [path], destination);
    const html = renderMarkdown(source, new Map(loaded.map((key) => [key, "blob:loaded"])));
    assert.equal((html.match(/<img[^>]*src="blob:loaded"/g) ?? []).length, 2, destination);
    assert.ok(!html.includes("href="), destination);
  }
});

test("code excludes links and images for nested lists, quotes, tilde and long fences", () => {
  const body = "[hidden](https://hidden.test) ![image](hidden.png)";
  for (const source of [
    `\`${body}\``,
    `~~~\n${body}\n~~~`,
    `1. Item\n\n   \`\`\`\n   ${body}\n   \`\`\``,
    `> \`\`\`\n> ${body}\n> \`\`\``,
    `\`\`\`\`markdown\n\`\`\`js\n${body}\n\`\`\`\n\`\`\`\``,
  ]) {
    assert.ok(!renderMarkdown(source, true).includes("data-local-image"));
    assert.ok(!renderMarkdown(source).includes("<a "));
    assert.deepEqual(markdownLinks(source), []);
    assert.deepEqual(markdownImages(source), []);
  }
});

test("references share the same grammar for rendering and link/image discovery", () => {
  const source = "[docs][d] ![shot][i]\n\n[d]: https://example.test/docs\n[i]: ./shot.png";
  assert.match(renderMarkdown(source, true), /href="https:\/\/example.test\/docs"/);
  assert.deepEqual(markdownLinks(source), [
    { url: "https://example.test/docs", label: "docs", kind: "markdown" },
  ]);
  assert.deepEqual(markdownImages(source), ["./shot.png"]);
});

test("GFM tables, lists and quoted blocks preserve their semantic structure", () => {
  const html = renderMarkdown(
    "4. Fourth\n\n5. Fifth\n\n> Quote\n>\n> - item\n\n| Before |\n| --- |\n| table |\n\nAfter",
  );
  assert.match(html, /<ol start="4">[\s\S]*?Fourth[\s\S]*?Fifth[\s\S]*?<\/ol>/);
  assert.match(html, /<blockquote>[\s\S]*?<ul>[\s\S]*?item[\s\S]*?<\/ul>[\s\S]*?<\/blockquote>/);
  assert.ok(html.includes('aria-label="Table"'));
  assert.ok(html.indexOf("</table>") < html.indexOf("After"));
});
