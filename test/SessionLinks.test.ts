import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg } from "../shared/wire.ts";
import { linkLabel, sessionLinks } from "../web/src/lib/sessionLinks.ts";

const msg = (id: string, role: RenderMsg["role"], text: string): RenderMsg => ({ id, role, text });

test("links come from what the user and Pi wrote, newest first, each URL once", () => {
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
    { url: "http://127.0.0.1:7172/s/abc", label: "127.0.0.1:7172/s/abc", messageId: "a2" },
    { url: "https://github.com/a/b/pull/7", label: "the PR", messageId: "a1" },
    { url: "https://example.com/docs", label: "example.com/docs", messageId: "u1" },
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
        "    https://indented.example.com/x",
        "Then read https://example.com/guide), or (https://example.com/other).",
      ].join("\n"),
    ),
  ]);
  assert.deepEqual(
    links.map((l) => l.url),
    ["https://example.com/guide", "https://example.com/other"],
  );
});

test("a markdown link whose text is its URL, or a non-web link, gets no special label", () => {
  const links = sessionLinks([
    msg(
      "a1",
      "assistant",
      "[https://example.com/a?x=1](https://example.com/a?x=1) and [the file](docs/guide.md) and [repo](https://github.com/goofansu/piano)",
    ),
  ]);
  assert.deepEqual(links, [
    { url: "https://example.com/a?x=1", label: "example.com/a…", messageId: "a1" },
    { url: "https://github.com/goofansu/piano", label: "repo", messageId: "a1" },
  ]);
});

test("linkLabel names GitHub issues and pull requests compactly and trims other URLs", () => {
  assert.equal(linkLabel("https://github.com/a/b/issues/12"), "b#12");
  assert.equal(linkLabel("https://github.com/a/b"), "a/b");
  assert.equal(linkLabel("https://example.com/"), "example.com");
  assert.equal(linkLabel("https://example.com/path/#frag"), "example.com/path…");
  assert.equal(linkLabel("not a url"), "not a url");
});
