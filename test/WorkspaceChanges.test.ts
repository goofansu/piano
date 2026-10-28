import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { Effect } from "effect";
import {
  type PreviewOptions,
  WorkspaceChanges,
  WorkspaceChangesLive,
} from "../server/WorkspaceChanges.ts";
import type { WorkspaceChanges as Observation } from "../shared/wire.ts";
import { parseUnifiedDiff } from "../web/src/lib/diff.ts";

function fixture(t: TestContext) {
  const repo = mkdtempSync(join(tmpdir(), "piano-live-changes-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const gitInput = (input: string | undefined, ...args: string[]) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      {
        input,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    );
  const git = (...args: string[]) => gitInput(undefined, ...args);
  git("init", "-q");
  const workspace = { id: "scratch", folder: repo, path: repo };
  const read = (options: PreviewOptions & { readonly path?: string }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* WorkspaceChanges).preview(workspace, options);
      }).pipe(Effect.provide(WorkspaceChangesLive)),
    );
  const preview = (path?: string) => read({ scope: "uncommitted", path });
  return { repo, git, gitInput, preview, read };
}

/** The result of a read whose scope cannot be read, or the test fails. */
function unavailable(value: Observation) {
  assert.equal(value.result.status, "unavailable", JSON.stringify(value.result));
  if (value.result.status !== "unavailable") throw new Error("Preview did not refuse");
  return value.result;
}
test("written files: internal directory aliases share identity without poisoning Git's ignore query; a removed file is missing", async (t) => {
  const { repo } = fixture(t);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\n");
  symlinkSync("src", join(repo, "alias"));
  writeFileSync(join(repo, ".gitignore"), "*.log\n");
  writeFileSync(join(repo, "build.log"), "ignored output\n");
  const observation = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* WorkspaceChanges).written({ id: "scratch", folder: repo, path: repo }, [
        "src/a.ts",
        "alias/a.ts",
        "build.log",
        "src/removed.ts",
      ]);
    }).pipe(Effect.provide(WorkspaceChangesLive)),
  );
  assert.deepEqual(observation.result, {
    status: "ready",
    files: [
      { path: "src/a.ts", verdict: "listed", placed: "src/a.ts" },
      { path: "alias/a.ts", verdict: "listed", placed: "src/a.ts" },
      { path: "build.log", verdict: "ignored", placed: "build.log" },
      { path: "src/removed.ts", verdict: "missing", placed: "src/removed.ts" },
    ],
  });
});

function ready(value: Observation) {
  assert.equal(value.result.status, "ready", JSON.stringify(value.result));
  if (value.result.status !== "ready") throw new Error("Preview failed");
  return value.result;
}

test("live changes: >10k tracked paths do not gate a tiny edit; index remains untouched", async (t) => {
  const { repo, git, preview } = fixture(t);
  mkdirSync(join(repo, "files"));
  for (let i = 0; i < 10_010; i++) writeFileSync(join(repo, "files", `${i}.txt`), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const index = readFileSync(join(repo, ".git/index"));
  writeFileSync(join(repo, "files/7.txt"), "tiny edit\n");
  const result = ready(await preview());
  assert.deepEqual(result.files, [
    { path: "files/7.txt", additions: 1, deletions: 1, binary: false },
  ]);
  assert.match(result.diff, /\+tiny edit/);
  assert.equal(result.truncated, false);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
});

test("live changes: unborn HEAD, literal unusual untracked paths, binary and ignored files", async (t) => {
  const { repo, git, preview } = fixture(t);
  const name = 'odd\n\t"雪[*].txt\\';
  writeFileSync(join(repo, name), "new source\n");
  writeFileSync(join(repo, "binary"), Buffer.from([0, 1, 2]));
  writeFileSync(join(repo, ".gitignore"), "ignored\n");
  writeFileSync(join(repo, "ignored"), "secret\n");
  const result = ready(await preview());
  assert.equal(result.head, null);
  assert.deepEqual(result.files.map((f) => f.path).sort(), [".gitignore", "binary", name].sort());
  assert.equal(result.files.find((f) => f.path === "binary")!.binary, true);
  const single = ready(await preview(name));
  assert.deepEqual(
    single.files.map((f) => f.path),
    [name],
  );
  assert.match(single.diff, /\+new source/);
  assert.equal(
    parseUnifiedDiff(single.diff)[0].path,
    name,
    "Git quoting must match the lazy file identity",
  );
  assert.equal(existsSync(join(repo, ".git/index")), false);
  git("add", ".");
  git("commit", "-qm", "base");
  assert.equal((await preview("../outside")).result.status, "error");
});

test("live changes: complete metadata survives bounded initial and per-file patches; lazy reads are fresh", async (t) => {
  const { repo, git, preview } = fixture(t);
  writeFileSync(join(repo, "base"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(join(repo, "a-large"), "line of source\n".repeat(100_000));
  writeFileSync(join(repo, "z-small"), "small\n");
  const initial = ready(await preview());
  assert.deepEqual(
    initial.files.map((f) => f.path),
    ["a-large", "z-small"],
  );
  assert.equal(initial.truncated, true);
  assert.ok(Buffer.byteLength(initial.diff) <= 120_000);
  const big = ready(await preview("a-large"));
  assert.equal(big.truncated, true);
  assert.ok(Buffer.byteLength(big.diff) <= 1_048_576);
  assert.ok(big.diff.length > 120_000);
  writeFileSync(join(repo, "z-small"), "fresh lazy read\n");
  const small = ready(await preview("z-small"));
  assert.equal(small.truncated, false);
  assert.match(small.diff, /\+fresh lazy read/);
});

test("live changes: metadata overflow is an error, never a partial or empty file list", async (t) => {
  const untracked = fixture(t);
  for (let i = 0; i < 5001; i++) writeFileSync(join(untracked.repo, `${i}.txt`), "");
  assert.equal(
    ready(await untracked.preview()).files.length,
    5001,
    "No silent untracked-count fallback",
  );
  assert.equal(existsSync(join(untracked.repo, ".git/index")), false);

  const { repo, git, gitInput, preview } = fixture(t);
  // Deleted index-only paths overflow numstat without creating/removing 28k files.
  // Avoid needless filesystem event pressure on unrelated strict capture tests.
  const directory = join("d".repeat(200), "e".repeat(200), "f".repeat(200));
  const blob = gitInput("base\n", "hash-object", "-w", "--stdin").trim();
  const entries = Array.from(
    { length: 28_000 },
    (_, i) => `100644 ${blob}\t${directory}/${i}.txt\0`,
  ).join("");
  gitInput(entries, "update-index", "--add", "-z", "--index-info");
  git("commit", "-qm", "index-only base");
  const index = readFileSync(join(repo, ".git/index"));
  const observation = await preview();
  assert.equal(observation.result.status, "error");
  if (observation.result.status === "error")
    assert.match(observation.result.detail, /metadata exceeds 16 MiB; no partial file list/);
  assert.equal("files" in observation.result, false);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
});

test("live changes: local filters and diff programs never run and intent-to-add never modifies user index", async (t) => {
  const { repo, git, preview } = fixture(t);
  writeFileSync(join(repo, "tracked"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const index = readFileSync(join(repo, ".git/index"));
  writeFileSync(join(repo, ".gitattributes"), "* filter=trap diff=trap\n");
  git("config", "filter.trap.clean", "touch FILTER_RAN; cat");
  git("config", "filter.trap.process", "touch PROCESS_RAN; false");
  git("config", "filter.trap.required", "true");
  git("config", "diff.trap.command", "touch DIFF_RAN");
  git("config", "diff.trap.textconv", "touch TEXTCONV_RAN");
  writeFileSync(join(repo, "tracked"), "changed\n");
  writeFileSync(join(repo, "new"), "untracked\n");
  assert.match(ready(await preview()).diff, /\+changed/);
  for (const marker of ["FILTER_RAN", "PROCESS_RAN", "DIFF_RAN", "TEXTCONV_RAN"])
    assert.equal(existsSync(join(repo, marker)), false);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
});

test("branch scope: a commit or push keeps the branch's patch; advancing only the target adds nothing", async (t) => {
  const { repo, git, read } = fixture(t);
  git("switch", "-qc", "main");
  writeFileSync(join(repo, "a"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("switch", "-qc", "feature");
  writeFileSync(join(repo, "a"), "edited\n");
  writeFileSync(join(repo, "b"), "new\n");
  const hints = { worktreeBase: "main" };
  const before = ready(await read({ scope: "branch", hints }));
  assert.equal(before.comparison.scope, "branch");
  assert.equal(before.comparison.target?.name, "main");
  assert.equal(before.comparison.target?.from, "worktree");
  assert.deepEqual(
    before.files.map((f) => f.path),
    ["a", "b"],
  );
  assert.deepEqual(before.scopes, [
    { scope: "branch", available: true, target: before.comparison.target },
    { scope: "uncommitted", available: true },
  ]);
  // The comparison is content-preserving: committing changes nothing a reader sees.
  git("add", ".");
  git("commit", "-qm", "work");
  const committed = ready(await read({ scope: "branch", hints }));
  assert.equal(committed.diff, before.diff);
  assert.equal(committed.comparison.base, before.comparison.base);
  assert.deepEqual(ready(await read({ scope: "uncommitted" })).files, []);
  // Only the target moves: the branch's patch is unchanged and the new target commit is not in it.
  git("switch", "-q", "main");
  writeFileSync(join(repo, "c"), "elsewhere\n");
  git("add", ".");
  git("commit", "-qm", "target moves");
  git("switch", "-q", "feature");
  const advanced = ready(await read({ scope: "branch", hints }));
  assert.equal(advanced.diff, before.diff);
  assert.equal(advanced.comparison.base, before.comparison.base);
  // Without a scope, Uncommitted stays the default even when Branch can be read.
  assert.equal(ready(await read({ hints })).comparison.scope, "uncommitted");
  assert.deepEqual(ready(await read({})).files, []);
  // Explicit Branch still resolves a local main when there is no hint or remote.
  const assumed = ready(await read({ scope: "branch" }));
  assert.equal(assumed.comparison.target?.from, "assumed");
  assert.equal(assumed.comparison.target?.ref, "refs/heads/main");
  // A per-file read names the same comparison, so the browser can refuse one that moved.
  const single = ready(await read({ scope: "branch", hints, path: "a" }));
  assert.deepEqual(single.comparison, advanced.comparison);
  assert.match(single.diff, /\+edited/);
});

test("branch scope: the target is the pull request's base for its own head, else the worktree's base, else the remote's default", async (t) => {
  const { git, read } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("branch", "-q", "release");
  git("switch", "-qc", "feature");
  git("commit", "-q", "--allow-empty", "-m", "work");
  git("remote", "add", "origin", "https://github.com/example/repo.git");
  git("update-ref", "refs/remotes/origin/release", "release");
  const pullRequest = {
    head: "feature",
    base: "release",
    headRepo: "example/repo",
    baseRepo: "example/repo",
  };
  const fromPr = ready(
    await read({ scope: "branch", hints: { pullRequest, worktreeBase: "main" } }),
  );
  assert.deepEqual(
    [fromPr.comparison.target?.name, fromPr.comparison.target?.from],
    ["release", "pull-request"],
  );
  // A pull request for another branch never retargets this one.
  const other = ready(
    await read({
      scope: "branch",
      hints: { pullRequest: { ...pullRequest, head: "other" }, worktreeBase: "main" },
    }),
  );
  assert.deepEqual(
    [other.comparison.target?.name, other.comparison.target?.from],
    ["main", "worktree"],
  );
  // Older callers' bare hints and untrusted rev expressions do not acquire repository authority.
  for (const hint of [
    { head: "feature", base: "release" },
    { ...pullRequest, base: "release~0" },
    { ...pullRequest, baseRepo: "unrelated/repo" },
  ]) {
    const ignored = ready(
      await read({ scope: "branch", hints: { pullRequest: hint, worktreeBase: "main" } }),
    );
    assert.equal(ignored.comparison.target?.from, "worktree");
  }
  // The remote's default branch as Git holds it locally, never fetched.
  const main = git("rev-parse", "main").trim();
  git("update-ref", "refs/remotes/origin/main", main);
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const remote = ready(await read({ scope: "branch" }));
  assert.deepEqual(
    [remote.comparison.target?.ref, remote.comparison.target?.from],
    ["refs/remotes/origin/main", "remote-default"],
  );
  // A hinted base Git does not hold falls through to the next rule, named.
  const missing = ready(await read({ scope: "branch", hints: { worktreeBase: "gone" } }));
  assert.equal(missing.comparison.target?.from, "remote-default");
});

test("branch scope: a pull request applies to the branch by its name on its remote", async (t) => {
  const { git, read } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("branch", "-q", "release");
  git("switch", "-qc", "feat");
  git("commit", "-q", "--allow-empty", "-m", "work");
  git("remote", "add", "origin", "https://github.com/example/repo.git");
  git("update-ref", "refs/remotes/origin/release", "release");
  git("update-ref", "refs/remotes/origin/james/feat", "HEAD");
  git("config", "branch.feat.remote", "origin");
  git("config", "branch.feat.merge", "refs/heads/james/feat");
  git("config", "push.default", "upstream");
  const pullRequest = { base: "release", headRepo: "example/repo", baseRepo: "example/repo" };
  const target = async (head: string) =>
    ready(
      await read({
        scope: "branch",
        hints: { pullRequest: { ...pullRequest, head }, worktreeBase: "main" },
      }),
    ).comparison.target?.from;
  assert.equal(await target("james/feat"), "pull-request");
  // The local name is not what GitHub knows this branch as.
  assert.equal(await target("feat"), "worktree");
});

test("branch scope: a fork's pull request into a same-named base compares with that base, not this branch", async (t) => {
  const { git, read } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("remote", "add", "upstream", "https://github.com/owner/repo.git");
  git("update-ref", "refs/remotes/upstream/main", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "work");
  git("remote", "add", "origin", "https://github.com/me/repo.git");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("config", "branch.main.remote", "origin");
  git("config", "branch.main.merge", "refs/heads/main");
  const pullRequest = { head: "main", headRepo: "me/repo", base: "main", baseRepo: "owner/repo" };
  const fork = ready(await read({ scope: "branch", hints: { pullRequest } }));
  assert.deepEqual(
    [fork.comparison.target?.ref, fork.comparison.target?.from],
    ["refs/remotes/upstream/main", "pull-request"],
  );
  assert.equal(fork.pullRequestFromBranch, true);
  // Its own remote-tracking ref is still this branch.
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  assert.equal(unavailable(await read({ scope: "branch" })).detail, "main is the base branch.");
  // A branch started from its remote's default tracks it under another name: that is its target.
  git("switch", "-qc", "feat", "--track", "origin/main");
  git("commit", "-q", "--allow-empty", "-m", "feat");
  const started = ready(await read({ scope: "branch" }));
  assert.deepEqual(
    [started.comparison.target?.ref, started.comparison.target?.from],
    ["refs/remotes/origin/main", "remote-default"],
  );
});

test("Changes says whether the linked pull request is from this branch, by its name on its remote, in any scope", async (t) => {
  const { git, read } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("switch", "-qc", "feat");
  git("commit", "-q", "--allow-empty", "-m", "work");
  git("remote", "add", "origin", "https://github.com/example/repo.git");
  git("config", "branch.feat.remote", "origin");
  git("config", "branch.feat.merge", "refs/heads/james/feat");
  git("config", "push.default", "upstream");
  // Git holds no ref for the base: the PR cannot be the target, yet it is still this branch's.
  const pullRequest = { base: "release", headRepo: "example/repo", baseRepo: "example/repo" };
  const fromBranch = async (hint: object, scope: "uncommitted" | "branch" = "uncommitted") => {
    const { result } = await read({
      scope,
      hints: { pullRequest: { ...pullRequest, ...hint } },
    });
    assert.notEqual(result.status, "error");
    return result.status === "error" ? undefined : result.pullRequestFromBranch;
  };
  assert.equal(await fromBranch({ head: "james/feat" }), true);
  assert.equal(await fromBranch({ head: "feat" }), false, "the local name is not GitHub's");
  assert.equal(
    await fromBranch({ head: "james/feat", headRepo: "fork/repo" }),
    false,
    "a fork's same-named branch is another",
  );
  assert.equal(await fromBranch({ head: "james/feat" }, "branch"), true);
  assert.equal(ready(await read({ scope: "uncommitted" })).pullRequestFromBranch, false);
});

test("branch scope: unavailable states are named, never another comparison", async (t) => {
  const unborn = fixture(t);
  assert.equal(unavailable(await unborn.read({ scope: "branch" })).detail, "No commits yet.");
  assert.equal(ready(await unborn.read({})).comparison.scope, "uncommitted");

  const { repo, git, read } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  const onMain = unavailable(await read({ scope: "branch" }));
  assert.equal(onMain.detail, "main is the base branch.");
  assert.deepEqual(onMain.scopes, [
    {
      scope: "branch",
      available: false,
      reason: "main is the base branch.",
      target: {
        name: "main",
        ref: "refs/heads/main",
        commit: git("rev-parse", "HEAD").trim(),
        from: "assumed",
      },
    },
    { scope: "uncommitted", available: true },
  ]);
  assert.equal(ready(await read({})).comparison.scope, "uncommitted");
  git("switch", "-q", "--detach");
  assert.equal(unavailable(await read({ scope: "branch" })).detail, "Detached HEAD.");
  git("switch", "-qc", "solo");
  git("branch", "-qD", "main");
  assert.equal(unavailable(await read({ scope: "branch" })).detail, "No base branch known.");
  // Unrelated history: an orphan branch shares nothing with the target.
  git("branch", "-q", "main");
  git("switch", "-q", "--orphan", "orphan");
  writeFileSync(join(repo, "o"), "orphan\n");
  git("add", ".");
  git("commit", "-qm", "orphan");
  assert.equal(unavailable(await read({ scope: "branch" })).detail, "No common history with main.");
  // A criss-cross merge has two merge bases: ambiguous, not one picked quietly.
  git("switch", "-q", "main");
  writeFileSync(join(repo, "m1"), "");
  git("add", ".");
  git("commit", "-qm", "A");
  git("switch", "-qc", "feature");
  writeFileSync(join(repo, "f1"), "");
  git("add", ".");
  git("commit", "-qm", "B");
  const b = git("rev-parse", "HEAD").trim();
  git("switch", "-q", "main");
  writeFileSync(join(repo, "m2"), "");
  git("add", ".");
  git("commit", "-qm", "C");
  git("switch", "-q", "feature");
  git("merge", "-q", "--no-edit", "main");
  git("switch", "-q", "main");
  git("merge", "-q", "--no-edit", b);
  git("switch", "-q", "feature");
  assert.equal(
    unavailable(await read({ scope: "branch" })).detail,
    "Ambiguous merge base with main.",
  );
});

test("a merge conflict leaves the scope unavailable, keeping the scopes and local work", async (t) => {
  const { repo, git, read, preview } = fixture(t);
  git("switch", "-qc", "main");
  writeFileSync(join(repo, "a"), "base\n");
  writeFileSync(join(repo, "b"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("switch", "-qc", "feature");
  writeFileSync(join(repo, "a"), "feature\n");
  git("commit", "-qam", "feature");
  git("switch", "-q", "main");
  writeFileSync(join(repo, "a"), "main\n");
  git("commit", "-qam", "main");
  git("switch", "-q", "feature");
  assert.throws(() => git("merge", "-q", "--no-edit", "main"));
  const conflicted = unavailable(await read({}));
  assert.equal(conflicted.scope, "uncommitted");
  assert.equal(
    conflicted.detail,
    "Unresolved merge conflicts; resolve them before browsing this diff.",
  );
  assert.equal(conflicted.branch, "feature");
  assert.deepEqual(conflicted.local, { commitsNotPushed: null, uncommitted: true });
  assert.ok(conflicted.scopes.some((s) => s.scope === "uncommitted"));
  // A file outside the conflict still reads.
  assert.equal(ready(await preview("b")).files.length, 0);
});

test("local work: commits not pushed count against the branch's upstream, not a same-named remote branch", async (t) => {
  const { git, preview } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("remote", "add", "origin", "https://github.com/example/repo.git");
  git("switch", "-qc", "feat");
  git("commit", "-q", "--allow-empty", "-m", "pushed");
  git("update-ref", "refs/remotes/origin/james/feat", "HEAD");
  // An unrelated `origin/feat` must not be what the branch is counted against.
  git("update-ref", "refs/remotes/origin/feat", "main");
  git("config", "branch.feat.remote", "origin");
  git("config", "branch.feat.merge", "refs/heads/james/feat");
  git("config", "push.default", "upstream");
  git("commit", "-q", "--allow-empty", "-m", "local 1");
  git("commit", "-q", "--allow-empty", "-m", "local 2");
  assert.equal(ready(await preview()).local.commitsNotPushed, 2);
});

test("a branch started from a remote branch compares and counts by its own name on that remote", async (t) => {
  const { git, read, preview } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("branch", "-q", "release");
  // Without `refs/remotes/origin/HEAD`, as `git remote add` and `git fetch` leave it.
  git("remote", "add", "origin", "https://github.com/example/repo.git");
  git("update-ref", "refs/remotes/origin/main", "main");
  git("update-ref", "refs/remotes/origin/release", "release");
  git("config", "push.default", "simple");
  // `git switch -c feat origin/main`, then `git push origin feat` without `-u`.
  git("switch", "-qc", "feat", "--track", "origin/main");
  git("commit", "-q", "--allow-empty", "-m", "pushed");
  git("update-ref", "refs/remotes/origin/feat", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "local");
  assert.equal(ready(await preview()).local.commitsNotPushed, 1);
  const pullRequest = {
    head: "feat",
    base: "release",
    headRepo: "example/repo",
    baseRepo: "example/repo",
  };
  const branch = ready(await read({ scope: "branch", hints: { pullRequest } }));
  assert.equal(branch.pullRequestFromBranch, true);
  assert.deepEqual(
    [branch.comparison.target?.ref, branch.comparison.target?.from],
    ["refs/remotes/origin/release", "pull-request"],
  );
});

test("a branch pushed to a fork compares with the base on the remote it started from", async (t) => {
  const { repo, git, read } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  // The fork is `origin` and the repository it came from is `upstream`, one commit ahead.
  git("remote", "add", "origin", "https://github.com/me/repo.git");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  writeFileSync(join(repo, "u"), "upstream\n");
  git("add", "u");
  git("commit", "-qm", "upstream");
  git("remote", "add", "upstream", "https://github.com/owner/repo.git");
  git("update-ref", "refs/remotes/upstream/main", "HEAD");
  git("symbolic-ref", "refs/remotes/upstream/HEAD", "refs/remotes/upstream/main");
  git("config", "remote.pushDefault", "origin");
  // `git switch -c feat upstream/main`: the work goes to the fork.
  git("switch", "-qc", "feat", "--track", "upstream/main");
  writeFileSync(join(repo, "f"), "feat\n");
  git("add", "f");
  git("commit", "-qm", "feat");
  for (const [hints, from] of [
    [{ worktreeBase: "main" }, "worktree"],
    [{}, "remote-default"],
  ] as const) {
    const branch = ready(await read({ scope: "branch", hints }));
    assert.deepEqual(
      [branch.comparison.target?.ref, branch.comparison.target?.from],
      ["refs/remotes/upstream/main", from],
    );
    assert.deepEqual(
      branch.files.map((f) => f.path),
      ["f"],
      "upstream's commits are not this branch's work",
    );
  }
});
