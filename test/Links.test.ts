import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg } from "../shared/wire.ts";
import { describeLink, sessionLinks, withStatus } from "../web/src/lib/links.ts";

const msg = (id: string, role: RenderMsg["role"], text: string): RenderMsg => ({ id, role, text });

test("the pile keeps pull requests, issues and local servers from prose, newest mention first", () => {
  const links = sessionLinks([
    msg("m1", "user", "Design a stack like https://www.hey.com/features/set-aside/. Compare https://github.com/basecamp/kamal/pull/12."),
    msg("m2", "assistant", "Opened https://github.com/basecamp/kamal/pull/12 for https://github.com/basecamp/kamal/issues/7 and the dev server at http://127.0.0.1:7172/sessions/abc?x=1.\n\n```bash\ncurl http://localhost:9999/not-a-reference\n```\nSee https://github.com/basecamp/kamal/blob/main/README.md and https://github.com/basecamp/kamal."),
    msg("m3", "tool_result", "fetched https://github.com/basecamp/kamal/pull/99 from tool output"),
  ]);
  assert.deepEqual(links.map((l) => [l.url, l.kind]), [
    ["http://127.0.0.1:7172/sessions/abc?x=1", "local"],
    ["https://github.com/basecamp/kamal/issues/7", "issue"],
    ["https://github.com/basecamp/kamal/pull/12", "pull_request"],
  ]);
  assert.deepEqual([links[0].title, links[0].detail], ["127.0.0.1:7172", "/sessions/abc?x=1"]);
  assert.deepEqual([links[2].title, links[2].detail], ["basecamp/kamal #12", "Pull request"]);
});

test("prose punctuation glued to a URL is not part of it", () => {
  const links = sessionLinks([
    msg("m1", "user", "See https://github.com/o/r/pull/3—review it, then http://localhost:3000/。再看 https://github.com/o/r/issues/4，谢谢 (and https://github.com/o/r/pull/5)."),
  ]);
  assert.deepEqual(links.map((l) => l.url), ["https://github.com/o/r/pull/5", "https://github.com/o/r/issues/4", "http://localhost:3000/", "https://github.com/o/r/pull/3"]);
});

test("other GitHub pages and ordinary websites are not kept", () => {
  for (const url of ["https://github.com/o/r", "https://github.com/o/r/commit/abc1234", "https://github.com/o/r/blob/main/x.ts", "https://github.com/o/r/actions/runs/9", "https://example.com/docs"]) {
    assert.equal(describeLink(url), undefined, url);
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
