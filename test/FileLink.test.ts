import assert from "node:assert/strict";
import { test } from "node:test";
import { documentReference, relativeToDocument } from "../web/src/lib/file-link.ts";

test("a reference resolves from its document's directory; absolute paths and replies do not", () => {
  assert.equal(relativeToDocument("docs/guide.md", "shots/a.png"), "docs/shots/a.png");
  assert.equal(relativeToDocument("docs/guide.md", "./shots/a.png"), "docs/shots/a.png");
  assert.equal(relativeToDocument("docs/guide.md", "../a.png"), "docs/../a.png");
  assert.equal(relativeToDocument("", "a.png"), "a.png");
  assert.equal(relativeToDocument("docs/guide.md", "/tmp/a.png"), "/tmp/a.png");
});

test("a document reference decodes escapes once and keeps any other % in the name", () => {
  for (const [reference, path] of [
    ["100%.png", "docs/100%.png"],
    ["2024-01-01T10:00.png", "docs/2024-01-01T10:00.png"],
    ["caf%C3%A9.png", "docs/café.png"],
    ["a%20b.md?x=1#top", "docs/a b.md"],
    ["file:///tmp/a.png", "/tmp/a.png"],
    ["https://example.com/a.png", undefined],
    ["//evil.invalid/a", undefined],
    ["javascript:alert(1)", undefined],
    ["#top", undefined],
    ["a%00.png", undefined],
    ["%C3", undefined],
  ] as const)
    assert.equal(documentReference("docs/page.html", reference), path, reference);
});
