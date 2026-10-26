import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg } from "../shared/wire.ts";
import { displayUrl, sessionLinks } from "../web/src/lib/sessionLinks.ts";
import { renderMarkdown } from "./fixtures/markdown.ts";

const msg = (id: string, role: RenderMsg["role"], text: string): RenderMsg => ({ id, role, text });

test("links come from what the user and Pi wrote, in conversation order, each URL once at its latest mention", () => {
  const links = sessionLinks([
    msg("u1", "user", "Look at https://example.com/docs and https://github.com/a/b/pull/7."),
    msg("a1", "assistant", "Opened [the PR](https://github.com/a/b/pull/7) for you."),
    msg(
      "t1",
      "tool_result",
      "npm ERR! see https://registry.npmjs.org/left-pad and https://example.com/hidden",
    ),
    msg("c1", "context", "Compaction mentions https://example.com/compacted"),
    msg("a2", "assistant", "Preview: <http://127.0.0.1:7172/s/abc>"),
  ]);
  assert.deepEqual(links, [
    { url: "https://example.com/docs", messageId: "u1" },
    { url: "https://github.com/a/b/pull/7", label: "the PR", messageId: "a1" },
    { url: "http://127.0.0.1:7172/s/abc", messageId: "a2" },
  ]);
});

test("a URL inside code is not a link, and a bare URL sheds trailing punctuation", () => {
  const links = sessionLinks([
    msg(
      "a1",
      "assistant",
      [
        "Run `curl https://api.example.com/v1` first.",
        "```",
        "fetch('https://fenced.example.com')",
        "```",
        "Then read https://example.com/guide), or (https://example.com/other).",
        "Open **http://localhost:3036/vite-dev/** and *http://faria.lvh.me:3017*.",
      ].join("\n"),
    ),
  ]);
  assert.deepEqual(
    links.map((l) => l.url),
    [
      "https://example.com/guide",
      "https://example.com/other",
      "http://localhost:3036/vite-dev/",
      "http://faria.lvh.me:3017",
    ],
  );
});

test("the Links list and the transcript agree on which text is a link", () => {
  const hrefs = (text: string) =>
    [...renderMarkdown(text).matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  for (const [text, urls] of [
    [
      "- Fixes:\n    - [the PR](https://example.com/pr) and https://github.com/a/b/pull/7",
      ["https://example.com/pr", "https://github.com/a/b/pull/7"],
    ],
    ["1. Step\n\n    See [docs](https://example.com/docs)", ["https://example.com/docs"]],
    ["~~~\nhttps://github.com/a/b/pull/8\n~~~", []],
    [
      "```\nhttps://github.com/a/b/pull/9\n```\nhttps://github.com/a/b/pull/10",
      ["https://github.com/a/b/pull/10"],
    ],
    ["See **https://github.com/a/b/pull/7** now", ["https://github.com/a/b/pull/7"]],
    ["![shot](https://example.com/a.png)", []],
  ] as const) {
    assert.deepEqual(hrefs(text), urls, text);
    assert.deepEqual(
      sessionLinks([msg("a1", "assistant", text)]).map((l) => l.url),
      urls,
      text,
    );
  }
});

test("a link's label is its markdown text, else GitHub's compact name; a non-web link is skipped", () => {
  const links = sessionLinks([
    msg(
      "a1",
      "assistant",
      "[https://example.com/a?x=1](https://example.com/a?x=1), [the file](docs/guide.md), [repo](https://github.com/goofansu/piano) and https://github.com/goofansu/piano/issues/3",
    ),
  ]);
  assert.deepEqual(links, [
    { url: "https://example.com/a?x=1", messageId: "a1" },
    { url: "https://github.com/goofansu/piano", label: "repo", messageId: "a1" },
    { url: "https://github.com/goofansu/piano/issues/3", label: "piano#3", messageId: "a1" },
  ]);
});

test("displayUrl drops the scheme, www and a trailing slash, keeping query and fragment", () => {
  assert.equal(displayUrl("https://github.com/a/b/pull/12"), "github.com/a/b/pull/12");
  assert.equal(displayUrl("https://www.example.com/"), "example.com");
  assert.equal(displayUrl("http://127.0.0.1:7172/s/abc?x=1#top"), "127.0.0.1:7172/s/abc?x=1#top");
  assert.equal(displayUrl("not a url"), "not a url");
});
