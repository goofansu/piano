import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type TestContext, test } from "node:test";
import { type Effect, Layer, ManagedRuntime } from "effect";
import {
  facts,
  type GitHubPullRequest,
  GitHubPullRequests,
  GitHubPullRequestsLive,
  githubRemote,
} from "../server/GitHubPullRequests.ts";
import { GhCommand } from "../server/Subprocess.ts";
import { pullRequestIdentity } from "../shared/pullRequestIdentity.ts";

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

test("translation preserves a fork's head repository separately from the URL's base repository", () => {
  const raw = pr({
    headRefName: "feature",
    baseRefName: "main",
    headRepository: { name: "Repo" },
    headRepositoryOwner: { login: "Fork" },
  });
  const translated = facts(raw);
  assert.deepEqual([translated.headRepo, translated.baseRepo], ["fork/repo", "example/repo"]);
  assert.deepEqual([translated.head, translated.base], ["feature", "main"]);
  assert.equal(facts({ ...raw, headRepository: null }).headRepo, undefined);
  assert.equal(facts({ ...raw, headRepositoryOwner: null }).headRepo, undefined);
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

const exe = "github.int.exe.xyz";
const url = "https://github.com/example/repo/pull/42";
/** A checkout with `remote`, a fake gh that checks the API route, and the adapter. */
async function routing(t: TestContext, remote: string) {
  const root = mkdtempSync(join(tmpdir(), "piano-gh-route-")),
    repo = join(root, "repo"),
    away = join(root, "not-a-checkout"),
    gh = join(root, "gh"),
    forge = join(root, "forge.json");
  mkdirSync(repo);
  mkdirSync(away);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "feature"], { env });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote], { env });
  writeFileSync(
    gh,
    `#!${process.execPath}\nprocess.env.PIANO_TEST_GH_FIXTURE = ${JSON.stringify(forge)};\nawait import(${JSON.stringify(resolve("test/fixtures/fake-gh.mjs"))});\n`,
    { mode: 0o755 },
  );
  const runtime = ManagedRuntime.make(
    GitHubPullRequestsLive.pipe(Layer.provide(Layer.succeed(GhCommand, gh))),
  );
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const github = await runtime.runPromise(GitHubPullRequests);
  /** Serve one open pull request, answering only through `host`. */
  const serve = (host: string) =>
    writeFileSync(
      forge,
      JSON.stringify({
        prs: [
          {
            ...pr({ headRefName: "feature", baseRefName: "main" }),
            headRepository: { name: "repo" },
            headRepositoryOwner: { login: "example" },
          },
        ],
        expectedHost: host,
        expectedRepo: `${host}/example/repo`,
      }),
    );
  const run = <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect);
  return { repo, away, github, serve, run };
}

test("routing: an exe.dev URL overrides a github.com remote, and the link records that route", async (t) => {
  const f = await routing(t, "git@github.com:example/repo.git");
  const link = await f.run(f.github.link(`https://${exe}/Example/Repo/pull/42/files`, f.repo));
  assert.deepEqual(link, { url, apiHost: exe });
  assert.deepEqual(await f.run(f.github.link(url, f.repo)), { url });
  await assert.rejects(
    f.run(f.github.link("https://github.com/example/repo/issues/42", f.repo)),
    /GitHub pull request URL/,
  );
});

test("routing: a saved apiHost wins over the checkout; without one the remote implies the route", async (t) => {
  const f = await routing(t, "git@github.com:example/repo.git");
  f.serve(exe);
  const viewed = await f.run(f.github.view({ url, apiHost: exe }, f.repo));
  assert.equal(viewed.number, 42);
  assert.deepEqual([viewed.headRepo, viewed.baseRepo], ["example/repo", "example/repo"]);
  await assert.rejects(f.run(f.github.view({ url }, f.repo)), /gh authentication/);
  const g = await routing(t, `https://${exe}/example/repo.git`);
  g.serve(exe);
  assert.deepEqual(await g.run(g.github.link(url, g.repo)), { url, apiHost: exe });
  assert.equal((await g.run(g.github.view({ url }, g.repo))).number, 42);
  const [found] = await g.run(g.github.openForHead(g.repo, "feature", "example/repo", exe));
  assert.deepEqual(found?.link, { url, apiHost: exe });
  assert.deepEqual(
    [found?.pullRequest.headRepo, found?.pullRequest.baseRepo],
    ["example/repo", "example/repo"],
  );
});

test("routing: github.com is the default when neither a checkout nor a GitHub remote names a route", async (t) => {
  const f = await routing(t, "https://gitlab.com/example/repo.git");
  f.serve("github.com");
  for (const cwd of [f.repo, f.away, join(f.away, "removed")]) {
    assert.deepEqual(await f.run(f.github.link(url, cwd)), { url }, cwd);
    assert.equal((await f.run(f.github.view({ url }, cwd))).number, 42, cwd);
  }
});
