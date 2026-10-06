import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg } from "../shared/wire.ts";
import { describeLink, sessionLinks, withStatus } from "../web/src/lib/links.ts";

const msg = (id: string, role: RenderMsg["role"], text: string): RenderMsg => ({ id, role, text });

test("links come from prose you or Pi wrote, newest mention first, without duplicates", () => {
  const links = sessionLinks([
    msg("m1", "user", "Design a stack like https://www.hey.com/features/set-aside/. Compare https://github.com/basecamp/kamal/pull/12."),
    msg("m2", "assistant", "Opened https://github.com/basecamp/kamal/pull/12 and the dev server at http://127.0.0.1:7172/sessions/abc?x=1.\n\n```bash\ncurl https://example.invalid/not-a-reference\n```\nSee [the glossary](https://example.com/docs/glossary)."),
    msg("m3", "tool_result", "fetched https://example.org/from-tool-output"),
  ]);
  assert.deepEqual(links.map((l) => [l.url, l.kind, l.messageId]), [
    ["https://example.com/docs/glossary", "web", "m2"],
    ["http://127.0.0.1:7172/sessions/abc?x=1", "local", "m2"],
    ["https://github.com/basecamp/kamal/pull/12", "pull_request", "m2"],
    ["https://www.hey.com/features/set-aside/", "web", "m1"],
  ]);
  assert.equal(links[0].title, "the glossary", "a markdown link keeps its text");
  assert.equal(links[1].detail, "/sessions/abc?x=1");
  assert.equal(links[3].title, "Set aside");
  assert.equal(links[3].detail, "hey.com");
});

test("GitHub URLs describe themselves", () => {
  const cases: Array<[string, string, string, string]> = [
    ["https://github.com/o/r/issues/7", "issue", "o/r #7", "Issue"],
    ["https://github.com/o/r/commit/0123456789abcdef", "commit", "o/r@0123456", "Commit"],
    ["https://github.com/o/r/compare/main...feature", "compare", "main...feature", "o/r · compare"],
    ["https://github.com/o/r/actions/runs/99", "run", "Run #99", "o/r"],
    ["https://github.com/o/r/blob/main/server/PiSessions.ts#L10-L20", "code", "PiSessions.ts L10–20", "o/r · main"],
    ["https://github.com/o/r", "repo", "o/r", "Repository"],
    ["https://github.com/o/r/pulls", "repo", "o/r", "Pulls"],
  ];
  for (const [url, kind, title, detail] of cases) {
    const link = describeLink(url);
    assert.ok(link, url);
    assert.deepEqual([link.kind, link.title, link.detail], [kind, title, detail], url);
  }
});

test("live status replaces the URL's own words and survives a trailing slash", () => {
  const [link] = withStatus(sessionLinks([msg("m1", "assistant", "https://github.com/o/r/pull/3/")]), [
    { _tag: "pull_request", url: "https://github.com/o/r/pull/3", repo: "o/r", number: 3, title: "Fit effort levels on one line", state: "open", checks: "success", review: "approved" },
  ]);
  assert.equal(link.title, "Fit effort levels on one line");
  assert.equal(link.detail, "o/r #3");
  assert.equal(link.status?._tag, "pull_request");
});
