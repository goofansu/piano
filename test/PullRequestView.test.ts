import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequest, SessionPullRequest } from "../shared/wire.ts";
import {
  pullRequestForm,
  pullRequestRow,
  pullRequestView,
} from "../web/src/lib/pullRequestView.ts";

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
});

test("no link has no view", () => {
  assert.equal(pullRequestView(undefined, now), undefined);
  assert.equal(pullRequestView({ link: null, pullRequest: null }, now), undefined);
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

test("the row names the PR, its state and what is still only local; branches only when the PR is not from the inspected branch", () => {
  const view = pullRequestView(linked(pr()), now)!;
  const row = pullRequestRow(view, {
    fromBranch: true,
    local: { commitsNotPushed: 2, uncommitted: true },
  });
  assert.equal(row.name, "#42");
  assert.equal(row.title, "The session deliverable");
  assert.deepEqual(
    pullRequestRow(view, { fromBranch: true, local: undefined, loading: true }).status,
    { state: "open", label: "Open" },
    "refreshing keeps the known status",
  );
  assert.deepEqual(row.status, { state: "open", label: "Open" });
  assert.deepEqual(
    row.signals.map((s) => s.label),
    ["Checks failed", "Approved"],
  );
  assert.deepEqual(row.local, ["2 commits not pushed", "Edits not committed"]);
  assert.equal(row.branches, undefined, "the PR was opened from the inspected branch");
  assert.deepEqual(
    pullRequestRow(view, { fromBranch: false, local: { commitsNotPushed: 1, uncommitted: false } }),
    {
      ...row,
      branches: { head: "feature", base: "main" },
      local: ["1 commit not pushed"],
    },
  );
  assert.deepEqual(
    pullRequestRow(view, {
      fromBranch: true,
      local: { commitsNotPushed: null, uncommitted: false },
    }).local,
    [],
    "nothing local says nothing",
  );
  // An unreadable status keeps its badge; a first read keeps only the link, without a badge.
  assert.deepEqual(
    pullRequestRow(pullRequestView(linked(null), now)!, { fromBranch: true, local: undefined })
      .status,
    {
      state: undefined,
      label: "Status unavailable",
    },
  );
  assert.equal(
    pullRequestRow(pullRequestView(linked(null), now)!, {
      fromBranch: true,
      local: undefined,
      loading: true,
    }).status,
    undefined,
  );
});

test("the link form submits only a non-blank URL while idle", () => {
  const canSubmit = (draft: string, busy = false) =>
    pullRequestForm({ url: draft, busy, finding: false, editing: false }).canSubmit;
  assert.equal(canSubmit(url), true);
  assert.equal(canSubmit(""), false);
  assert.equal(canSubmit("  "), false);
  assert.equal(canSubmit(url, true), false);
});

test("the link form offers Find from branch when linking and Cancel when changing a link", () => {
  assert.deepEqual(pullRequestForm({ url: "", busy: false, finding: false, editing: false }), {
    canSubmit: false,
    submitLabel: "Link",
    secondary: { action: "find", label: "Find from branch", disabled: false },
  });
  assert.deepEqual(pullRequestForm({ url, busy: true, finding: true, editing: false }).secondary, {
    action: "find",
    label: "Finding…",
    disabled: true,
  });
  const editing = pullRequestForm({ url, busy: false, finding: false, editing: true });
  assert.equal(editing.submitLabel, "Save link");
  assert.deepEqual(editing.secondary, { action: "cancel", label: "Cancel" });
});
