import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequest, SessionPullRequest } from "../shared/wire.ts";
import { pullRequestView } from "../web/src/lib/pullRequestView.ts";

const url = "https://github.com/example/repo/pull/42";
const now = Date.parse("2026-10-12T12:00:00Z");
const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  url,
  repo: "example/repo",
  number: 42,
  title: "The session deliverable",
  state: "open",
  checks: "failure",
  review: "approved",
  head: "feature",
  base: "main",
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  at: "2026-10-12T10:00:00Z",
  ...overrides,
});
const linked = (pullRequest: PullRequest | null): SessionPullRequest => ({
  link: { url, source: "manual" },
  pullRequest,
  discovery: true,
});

test("no link has no view, even with discovery state", () => {
  assert.equal(pullRequestView(undefined, now), undefined);
  assert.equal(
    pullRequestView({ link: null, pullRequest: null, discovery: false }, now),
    undefined,
  );
});

test("a link whose GitHub status is unavailable is named from its URL", () => {
  const view = pullRequestView(linked(null), now);
  assert.equal(view?.number, "42");
  assert.equal(view?.repo, "example/repo");
  assert.equal(view?.url, url);
  assert.equal(view?.status, undefined);
  assert.equal(view?.title, undefined);
  assert.equal(view?.active, false);
  assert.equal(view?.timeLabel, undefined);
  assert.deepEqual(view?.signals, []);
});

test("an open PR shows checks then review, and when it was last updated", () => {
  const view = pullRequestView(linked(pr()), now);
  assert.deepEqual(view?.status, { state: "open", label: "Open" });
  assert.equal(view?.active, true);
  assert.deepEqual(
    view?.signals.map((s) => s.label),
    ["Checks failed", "Approved"],
  );
  assert.equal(view?.timeLabel, "updated 2 hours ago");
  assert.deepEqual(view?.branches, { head: "feature", base: "main" });
  assert.deepEqual(view?.diff, { additions: 10, deletions: 2, changedFiles: 3 });
});

test("a draft is still active work", () => {
  const view = pullRequestView(
    linked(pr({ state: "draft", checks: "pending", review: "none" })),
    now,
  );
  assert.equal(view?.active, true);
  assert.deepEqual(view?.status, { state: "draft", label: "Draft" });
  assert.deepEqual(
    view?.signals.map((s) => s.label),
    ["Checks running"],
  );
});

test("merged and closed PRs drop checks and reviews and show when they were disposed", () => {
  for (const [state, label] of [
    ["merged", "Merged"],
    ["closed", "Closed"],
  ] as const) {
    const view = pullRequestView(linked(pr({ state, at: "2026-10-09T12:00:00Z" })), now);
    assert.equal(view?.active, false);
    assert.equal(view?.status?.label, label);
    assert.deepEqual(view?.signals, []);
    assert.equal(view?.timeLabel, "3 days ago");
  }
});

test("diff and branch facts appear only when GitHub reports them in full", () => {
  assert.equal(pullRequestView(linked(pr({ changedFiles: undefined })), now)?.diff, undefined);
  assert.equal(pullRequestView(linked(pr({ head: undefined })), now)?.branches, undefined);
});

test("a just-updated PR reads as just now", () => {
  const view = pullRequestView(linked(pr({ at: new Date(now - 30_000).toISOString() })), now);
  assert.equal(view?.timeLabel, "updated just now");
});
