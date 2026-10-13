import assert from "node:assert/strict";
import { test } from "node:test";
import {
  facts,
  type GitHubPullRequest,
  githubRemote,
  pullRequestIdentity,
} from "../server/GitHubPullRequests.ts";

const pr = (over: Partial<GitHubPullRequest> = {}): GitHubPullRequest => ({
  url: "https://github.com/example/repo/pull/42",
  number: 42,
  title: "Work",
  state: "OPEN",
  isDraft: false,
  reviewDecision: null,
  statusCheckRollup: null,
  ...over,
});
const checks = (...rollup: NonNullable<GitHubPullRequest["statusCheckRollup"]>) =>
  facts(pr({ statusCheckRollup: rollup })).checks;
const run = (status: string, conclusion: string | null = null) => ({
  __typename: "CheckRun",
  status,
  conclusion,
});
const status = (state: string) => ({ __typename: "StatusContext", state });

test("check rollup: any failure wins, then anything unfinished, and skipped or neutral runs pass", () => {
  assert.equal(checks(), "none");
  assert.equal(facts(pr()).checks, "none");
  assert.equal(checks(run("COMPLETED", "SUCCESS"), status("SUCCESS")), "success");
  assert.equal(checks(run("COMPLETED", "NEUTRAL"), run("COMPLETED", "SKIPPED")), "success");
  assert.equal(checks(run("COMPLETED", "SUCCESS"), run("IN_PROGRESS")), "pending");
  assert.equal(checks(run("QUEUED"), status("PENDING")), "pending");
  assert.equal(checks(status("EXPECTED")), "pending");
  assert.equal(checks(run("IN_PROGRESS"), run("COMPLETED", "FAILURE")), "failure");
  assert.equal(checks(run("COMPLETED", "CANCELLED")), "failure");
  assert.equal(checks(run("COMPLETED", "TIMED_OUT")), "failure");
  assert.equal(checks(status("PENDING"), status("ERROR")), "failure");
  assert.equal(checks(status("FAILURE")), "failure");
});

test("review decision and state map to wire values; disposed pull requests date their closure", () => {
  assert.equal(facts(pr({ reviewDecision: "APPROVED" })).review, "approved");
  assert.equal(facts(pr({ reviewDecision: "CHANGES_REQUESTED" })).review, "changes_requested");
  assert.equal(facts(pr({ reviewDecision: "REVIEW_REQUIRED" })).review, "review_required");
  assert.equal(facts(pr({ reviewDecision: null })).review, "none");
  assert.equal(facts(pr({ reviewDecision: "" })).review, "none");
  assert.equal(facts(pr({ isDraft: true })).state, "draft");
  assert.equal(facts(pr({ state: "MERGED", isDraft: true })).state, "merged");
  const times = { updatedAt: "2026-01-02T00:00:00Z", closedAt: "2026-01-01T00:00:00Z" };
  assert.equal(facts(pr({ state: "CLOSED", ...times })).at, times.closedAt);
  assert.equal(facts(pr({ state: "OPEN", ...times })).at, times.updatedAt);
});

test("facts canonicalize the URL and reject a response whose URL and number disagree", () => {
  const proxied = facts(pr({ url: "https://github.int.exe.xyz/Example/Repo/pull/42" }));
  assert.equal(proxied.url, "https://github.com/example/repo/pull/42");
  assert.equal(proxied.repo, "example/repo");
  assert.throws(() => facts(pr({ number: 43 })));
  assert.throws(() => facts(pr({ url: "https://github.com/example/repo/issues/42" })));
});

test("pull request URLs name a github.com or exe.dev integration pull request, nothing else", () => {
  assert.deepEqual(pullRequestIdentity(" https://github.com/Owner/Repo.js/pull/7/files "), {
    repo: "owner/repo.js",
    number: 7,
    url: "https://github.com/owner/repo.js/pull/7",
    host: "github.com",
  });
  assert.equal(
    pullRequestIdentity("https://github.int.exe.xyz/owner/repo/pull/7")?.host,
    "github.int.exe.xyz",
  );
  for (const url of [
    "not a url",
    "http://github.com/owner/repo/pull/7",
    "https://github.com:8443/owner/repo/pull/7",
    "https://github.example.com/owner/repo/pull/7",
    "https://github.com/owner/repo/pull/0",
    "https://github.com/owner/repo/pull/99999999999999999999",
  ])
    assert.equal(pullRequestIdentity(url), null, url);
});

test("remotes: github.com in https, scp and ssh forms, the exe.dev integration, and no other host", () => {
  for (const remote of [
    "https://github.com/Owner/Repo.git",
    "https://github.com/owner/repo/",
    "git@github.com:owner/repo.git",
    "ssh://git@github.com/owner/repo",
  ])
    assert.deepEqual(githubRemote(remote), { repo: "owner/repo", apiHost: "github.com" }, remote);
  assert.deepEqual(githubRemote("https://github.int.exe.xyz/Owner/Repo.git"), {
    repo: "owner/repo",
    apiHost: "github.int.exe.xyz",
  });
  // GitHub Enterprise and lookalike hosts are not routed: gh would authenticate elsewhere.
  for (const remote of [
    "https://github.example.com/owner/repo.git",
    "git@github.example.com:owner/repo.git",
    "https://github.com.evil/owner/repo.git",
    "https://github.int.exe.xyz.evil/owner/repo.git",
    "https://gitlab.com/owner/repo.git",
    "/srv/git/repo.git",
  ])
    assert.equal(githubRemote(remote), null, remote);
});
