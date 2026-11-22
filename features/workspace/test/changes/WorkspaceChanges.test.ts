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
import { GitCommand } from "../../../../server/shared/Subprocess.ts";
import { answerJson } from "../../../../shared/endpoint.ts";
import { forkWorktree } from "../../../../test/shared/forkWorktree.ts";
import {
  CHANGES_ANSWER_BYTES,
  CHANGES_INITIAL_PATCH_BYTES,
  type WorkspaceChanges as Observation,
} from "../../contracts/changes/http.ts";
import {
  type PreviewOptions,
  WorkspaceChanges,
  WorkspaceChangesLive,
} from "../../server/changes/WorkspaceChanges.ts";
import {
  askText,
  changedFile,
  changesSheet,
  initialDisclosure,
  type PatchSource,
  patchNote,
} from "../../web/changes/changesView.ts";
import { parseUnifiedDiff } from "../../web/changes/diff.ts";

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
  const sibling = `${repo}-sibling`;
  mkdirSync(join(sibling, "sub"), { recursive: true });
  t.after(() => rmSync(sibling, { recursive: true, force: true }));
  writeFileSync(join(sibling, "a.ts"), "sibling\n");
  symlinkSync(join(sibling, "sub"), join(repo, "away"));
  writeFileSync(join(repo, ".gitignore"), "*.log\n");
  writeFileSync(join(repo, "build.log"), "ignored output\n");
  const observation = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* WorkspaceChanges).written({ id: "scratch", folder: repo, path: repo }, [
        "src/a.ts",
        "alias/a.ts",
        "build.log",
        "src/removed.ts",
        "away/../a.ts",
        "alias/../src/a.ts",
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
      { path: "away/../a.ts", verdict: "outside" },
      { path: "alias/../src/a.ts", verdict: "listed", placed: "src/a.ts" },
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

test("non-UTF-8 patch content leaves the file list and other files available", async (t) => {
  const { repo, git, preview } = fixture(t);
  const csv = join(repo, "roster.csv");
  writeFileSync(csv, Buffer.from("René\n", "latin1"));
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(csv, Buffer.from("André\n", "latin1"));
  writeFileSync(join(repo, "app.ts"), "export const answer = 42;\n");

  const result = ready(await preview());
  assert.deepEqual(
    result.files.map((file) => file.path),
    ["app.ts", "roster.csv"],
  );
  assert.equal(result.truncated, true);
  assert.match(ready(await preview("app.ts")).diff, /\+export const answer = 42/);
  const csvResult = (await preview("roster.csv")).result;
  assert.equal(csvResult.status, "error");
  assert.match(csvResult.detail, /non-UTF-8/);
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

test("live changes: an answer past the answer budget is an error, never a partial file list", async (t) => {
  const directory = join("d".repeat(200), "e".repeat(200), "f".repeat(200));
  const commitPaths = (count: number) => {
    const fixed = fixture(t);
    const blob = fixed.gitInput("base\n", "hash-object", "-w", "--stdin").trim();
    const entries = Array.from(
      { length: count },
      (_, i) => `100644 ${blob}\t${directory}/${i}.txt\0`,
    ).join("");
    fixed.gitInput(entries, "update-index", "--add", "-z", "--index-info");
    fixed.git("commit", "-qm", "index-only base");
    return fixed;
  };
  const over = commitPaths(Math.ceil(CHANGES_ANSWER_BYTES / 600));
  const refused = await over.preview();
  assert.equal(refused.result.status, "error");
  if (refused.result.status === "error")
    assert.equal(
      refused.result.detail,
      "Changes are too large to list; no partial file list is shown.",
    );
  assert.equal((await over.preview(`${directory}/7.txt`)).result.status, "ready");

  const count = Math.floor(CHANGES_ANSWER_BYTES / 1_000);
  const answer = await commitPaths(count).preview();
  assert.equal(ready(answer).files.length, count);
  assert.ok(Buffer.byteLength(answerJson(answer)) <= CHANGES_ANSWER_BYTES);
});

test("live changes: thousands of long staged-only paths keep the full list, a bounded excerpt and per-file reads", async (t) => {
  const { repo, git, gitInput, preview } = fixture(t);
  writeFileSync(join(repo, "work.txt"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const blob = gitInput("staged\n", "hash-object", "-w", "--stdin").trim();
  const staged = Array.from({ length: 3_550 }, (_, i) =>
    [
      `${i % 10}`,
      `${i % 7}${"e".repeat(190)}`,
      `${i % 3}${"f".repeat(190)}`,
      "g".repeat(190),
      `${i}.txt`,
    ].join("/"),
  );
  gitInput(
    staged.map((path) => `100644 ${blob}\t${path}\0`).join(""),
    "update-index",
    "--add",
    "-z",
    "--index-info",
  );
  writeFileSync(join(repo, "work.txt"), "line of source\n".repeat(20_000));
  const index = readFileSync(join(repo, ".git/index"));

  const listed = await preview();
  const result = ready(listed);
  assert.equal(result.files.length, staged.length + 1);
  assert.deepEqual(result.files[0], {
    path: "work.txt",
    additions: 20_000,
    deletions: 1,
    binary: false,
  });
  assert.deepEqual(
    result.files.slice(1).map((f) => f.path),
    [...staged].sort(),
  );
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.diff) <= CHANGES_INITIAL_PATCH_BYTES);
  assert.deepEqual(
    parseUnifiedDiff(result.diff).map((f) => f.path),
    ["work.txt"],
  );
  assert.ok(Buffer.byteLength(answerJson(listed)) <= CHANGES_ANSWER_BYTES);

  const one = ready(await preview(staged[42]));
  assert.deepEqual(one.files, [
    { path: staged[42], additions: 1, deletions: 0, binary: false, staged: true },
  ]);
  assert.deepEqual(
    parseUnifiedDiff(one.diff).map((f) => f.path),
    [staged[42]],
  );
  assert.match(one.diff, /\+staged/);
  assert.equal(one.truncated, false);

  writeFileSync(join(repo, "work.txt"), "base\n");
  const cachedOnly = ready(await preview());
  assert.deepEqual(
    cachedOnly.files.map((f) => f.path),
    [...staged].sort(),
  );
  assert.equal(cachedOnly.truncated, true);
  assert.ok(Buffer.byteLength(cachedOnly.diff) <= CHANGES_INITIAL_PATCH_BYTES);
  const patched = parseUnifiedDiff(cachedOnly.diff).map((f) => f.path);
  assert.ok(patched.length > 20, "the excerpt spans many staged patches");
  assert.deepEqual(
    patched,
    cachedOnly.files.slice(0, patched.length).map((f) => f.path),
  );
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
  const hints = { worktreeBase: { branch: "feature", base: "main" } };
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
  git("add", ".");
  git("commit", "-qm", "work");
  const committed = ready(await read({ scope: "branch", hints }));
  assert.equal(committed.diff, before.diff);
  assert.equal(committed.comparison.base, before.comparison.base);
  assert.deepEqual(ready(await read({ scope: "uncommitted" })).files, []);
  git("switch", "-q", "main");
  writeFileSync(join(repo, "c"), "elsewhere\n");
  git("add", ".");
  git("commit", "-qm", "target moves");
  git("switch", "-q", "feature");
  const advanced = ready(await read({ scope: "branch", hints }));
  assert.equal(advanced.diff, before.diff);
  assert.equal(advanced.comparison.base, before.comparison.base);
  assert.equal(ready(await read({ hints })).comparison.scope, "uncommitted");
  assert.deepEqual(ready(await read({})).files, []);
  const assumed = ready(await read({ scope: "branch" }));
  assert.equal(assumed.comparison.target?.from, "assumed");
  assert.equal(assumed.comparison.target?.ref, "refs/heads/main");
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
    await read({
      scope: "branch",
      hints: { pullRequest, worktreeBase: { branch: "feature", base: "main" } },
    }),
  );
  assert.deepEqual(
    [fromPr.comparison.target?.name, fromPr.comparison.target?.from],
    ["release", "pull-request"],
  );
  const other = ready(
    await read({
      scope: "branch",
      hints: {
        pullRequest: { ...pullRequest, head: "other" },
        worktreeBase: { branch: "feature", base: "main" },
      },
    }),
  );
  assert.deepEqual(
    [other.comparison.target?.name, other.comparison.target?.from],
    ["main", "worktree"],
  );
  for (const hint of [
    { head: "feature", base: "release" },
    { ...pullRequest, base: "release~0" },
    { ...pullRequest, baseRepo: "unrelated/repo" },
  ]) {
    const ignored = ready(
      await read({
        scope: "branch",
        hints: { pullRequest: hint, worktreeBase: { branch: "feature", base: "main" } },
      }),
    );
    assert.equal(ignored.comparison.target?.from, "worktree");
  }
  const main = git("rev-parse", "main").trim();
  git("update-ref", "refs/remotes/origin/main", main);
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const remote = ready(await read({ scope: "branch" }));
  assert.deepEqual(
    [remote.comparison.target?.ref, remote.comparison.target?.from],
    ["refs/remotes/origin/main", "remote-default"],
  );
  const missing = ready(
    await read({ scope: "branch", hints: { worktreeBase: { branch: "feature", base: "gone" } } }),
  );
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
        hints: {
          pullRequest: { ...pullRequest, head },
          worktreeBase: { branch: "feat", base: "main" },
        },
      }),
    ).comparison.target?.from;
  assert.equal(await target("james/feat"), "pull-request");
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
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  assert.equal(unavailable(await read({ scope: "branch" })).detail, "main is the base branch.");
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
  git("remote", "set-url", "--push", "origin", "https://github.com/fork/repo.git");
  assert.equal(await fromBranch({ head: "james/feat", headRepo: "fork/repo" }), true);
  assert.equal(await fromBranch({ head: "james/feat" }), false, "it fetches from, not pushes to");
  git("update-ref", "refs/remotes/origin/release", "main");
  const hints = { pullRequest: { ...pullRequest, head: "james/feat", headRepo: "fork/repo" } };
  const branch = ready(await read({ scope: "branch", hints }));
  assert.deepEqual(
    [branch.comparison.target?.ref, branch.comparison.target?.from],
    ["refs/remotes/origin/release", "pull-request"],
  );
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
  git("branch", "-q", "main");
  git("switch", "-q", "--orphan", "orphan");
  writeFileSync(join(repo, "o"), "orphan\n");
  git("add", ".");
  git("commit", "-qm", "orphan");
  assert.equal(unavailable(await read({ scope: "branch" })).detail, "No common history with main.");
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
  assert.equal(ready(await preview("b")).files.length, 0);
});

test("live changes: a staged edit whose working copy matches HEAD stays listed with its staged patch until the index is clean", async (t) => {
  const { repo, git, preview } = fixture(t);
  writeFileSync(join(repo, "notes.txt"), "base\n");
  writeFileSync(join(repo, "other.txt"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(join(repo, "notes.txt"), "staged\n");
  git("add", "notes.txt");
  writeFileSync(join(repo, "notes.txt"), "base\n");
  writeFileSync(join(repo, "other.txt"), "unstaged\n");
  assert.equal(git("status", "--porcelain"), "MM notes.txt\n M other.txt\n");
  const index = readFileSync(join(repo, ".git/index"));

  const listed = ready(await preview());
  assert.deepEqual(listed.files, [
    { path: "other.txt", additions: 1, deletions: 1, binary: false },
    { path: "notes.txt", additions: 1, deletions: 1, binary: false, staged: true },
  ]);
  assert.deepEqual(listed.local, { commitsNotPushed: null, uncommitted: true });
  const patches = parseUnifiedDiff(listed.diff);
  assert.deepEqual(
    patches.map((f) => f.path),
    ["other.txt", "notes.txt"],
  );
  assert.match(patches[1]!.raw, /-base\n\+staged/);
  const file = ready(await preview("notes.txt"));
  assert.deepEqual(file.files, [listed.files[1]]);
  assert.match(file.diff, /-base\n\+staged/);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);

  writeFileSync(join(repo, "other.txt"), "base\n");
  assert.equal(ready(await preview()).local.uncommitted, true, "the index is still dirty");
  git("restore", "--staged", "notes.txt");
  const clean = ready(await preview());
  assert.deepEqual(clean.files, []);
  assert.equal(clean.diff, "");
  assert.equal(clean.local.uncommitted, false);
});

test("live changes: each loaded patch carries its own source, so its badge and Ask prompt agree with its contents", async (t) => {
  const { repo, git, preview } = fixture(t);
  const workspace = { id: "scratch", path: repo };
  const lines = (word: string) =>
    Array.from({ length: 3000 }, (_, i) => `${word} ${i} ${"x".repeat(40)}\n`).join("");
  writeFileSync(join(repo, "notes.txt"), "base\n");
  writeFileSync(join(repo, "big.txt"), lines("base"));
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(join(repo, "notes.txt"), "base\nindex only\n");
  git("add", "notes.txt");
  writeFileSync(join(repo, "notes.txt"), "base\n");
  const index = readFileSync(join(repo, ".git/index"));

  const listed = changesSheet({
    observation: await preview(),
    busy: false,
    disclosure: initialDisclosure,
  });
  assert.equal(listed.body.kind, "files");
  if (listed.body.kind !== "files") return;
  const seeded = listed.body.files.find((f) => f.metadata.path === "notes.txt")?.initial;
  assert.ok(seeded, "the staged patch arrives with the list");
  assert.equal(seeded.source, "index");
  assert.match(seeded.file.raw, /\+index only/);
  assert.equal(patchNote(seeded), "Staged changes");
  assert.match(askText(seeded), /^About `notes\.txt` \(staged diff from the index,/);
  assert.doesNotMatch(askText(seeded), /working-tree/);

  writeFileSync(join(repo, "big.txt"), lines("edit"));
  const observation = await preview();
  const deferred = changesSheet({ observation, busy: false, disclosure: initialDisclosure });
  if (deferred.body.kind !== "files" || observation.result.status !== "ready")
    throw new Error("Changes did not list files");
  const row = deferred.body.files.find((f) => f.metadata.path === "notes.txt");
  assert.equal(row?.metadata.staged, true);
  assert.equal(row?.initial, undefined, "the large sibling defers notes.txt to expansion");
  writeFileSync(join(repo, "notes.txt"), "base\ndisk edit\n");
  const loaded = changedFile(
    workspace,
    await preview("notes.txt"),
    "notes.txt",
    observation.result.comparison,
  );
  assert.equal(loaded.source, "working-tree");
  assert.match(loaded.file.raw, /\+disk edit/);
  assert.doesNotMatch(loaded.file.raw, /index only/);
  assert.equal(patchNote(loaded), undefined);
  assert.match(askText(loaded), /^About `notes\.txt` \(live working-tree diff/);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
});

test("live changes: a save between Git's file list and its patch never puts the working edit under the staged label", async (t) => {
  const { repo, git } = fixture(t);
  const workspace = { id: "scratch", folder: repo, path: repo };
  writeFileSync(join(repo, "notes.txt"), "base\n");
  writeFileSync(join(repo, "other.txt"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(join(repo, "notes.txt"), "staged version\n");
  git("add", "notes.txt");
  writeFileSync(join(repo, "notes.txt"), "base\n");
  writeFileSync(join(repo, "other.txt"), "unstaged\n");
  const index = readFileSync(join(repo, ".git/index"));
  const saving = join(repo, ".git", "save-on-patch");
  const savingGit = join(repo, ".git", "saving-git");
  writeFileSync(
    savingGit,
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';import {existsSync,rmSync,writeFileSync} from 'node:fs';
const a=process.argv.slice(2);
if(a.includes('--patch')&&existsSync(${JSON.stringify(saving)})){rmSync(${JSON.stringify(saving)});writeFileSync(${JSON.stringify(join(repo, "notes.txt"))},'working edit\\n');}
const r=spawnSync('git',a,{stdio:'inherit'});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );
  const read = (path?: string) => {
    writeFileSync(join(repo, "notes.txt"), "base\n");
    writeFileSync(saving, "");
    return Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* WorkspaceChanges).preview(workspace, { scope: "uncommitted", path });
      }).pipe(Effect.provide(WorkspaceChangesLive), Effect.provideService(GitCommand, savingGit)),
    );
  };
  const agrees = (loaded: ReturnType<typeof changedFile>) => {
    assert.equal(loaded.source, "index");
    assert.match(loaded.file.raw, /\+staged version/);
    assert.doesNotMatch(loaded.file.raw, /working edit/);
    assert.equal(patchNote(loaded), "Staged changes");
    assert.match(askText(loaded), /\+staged version/);
    assert.doesNotMatch(askText(loaded), /working edit|working-tree/);
  };

  const listed = await read();
  assert.ok(!existsSync(saving), "the save landed during the initial read");
  assert.equal(git("diff", "--cached", "--", "notes.txt").includes("+staged version"), true);
  const listedReady = ready(listed);
  assert.deepEqual(
    parseUnifiedDiff(listedReady.diff).map((f) => f.path),
    ["other.txt", "notes.txt"],
    "each listed path has one patch, from its declared source",
  );
  const sheet = changesSheet({ observation: listed, busy: false, disclosure: initialDisclosure });
  if (sheet.body.kind !== "files") throw new Error("Changes did not list files");
  const seeded = sheet.body.files.find((f) => f.metadata.path === "notes.txt")?.initial;
  assert.ok(seeded, "the staged patch arrives with the list");
  agrees(seeded);

  const deferred = await read("notes.txt");
  assert.ok(!existsSync(saving), "the save landed during the per-file read");
  const deferredReady = ready(deferred);
  assert.deepEqual(
    parseUnifiedDiff(deferredReady.diff).map((f) => f.path),
    ["notes.txt"],
  );
  agrees(changedFile(workspace, deferred, "notes.txt", listedReady.comparison));
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
});

test("live changes: a staged file and a working path beneath it each keep their own patch from their own Git source", async (t) => {
  const layouts = {
    "staged file, untracked child": (git: (...args: string[]) => string, repo: string) => {
      git("commit", "-q", "--allow-empty", "-m", "base");
      writeFileSync(join(repo, "dir"), "staged file\n");
      git("add", "dir");
      rmSync(join(repo, "dir"));
      mkdirSync(join(repo, "dir"));
      writeFileSync(join(repo, "dir", "child"), "working child\n");
      return { working: ["dir/child"], staged: ["dir"] };
    },
    "staged file replacing a directory, working tree at HEAD": (
      git: (...args: string[]) => string,
      repo: string,
    ) => {
      mkdirSync(join(repo, "dir"));
      writeFileSync(join(repo, "dir", "child"), "committed child\n");
      git("add", ".");
      git("commit", "-qm", "base");
      rmSync(join(repo, "dir"), { recursive: true });
      writeFileSync(join(repo, "dir"), "staged file\n");
      git("add", "-A", "dir");
      rmSync(join(repo, "dir"));
      git("restore", "--source=HEAD", "--worktree", "--", "dir/child");
      return { working: [], staged: ["dir", "dir/child"] };
    },
  };
  for (const [name, arrange] of Object.entries(layouts)) {
    const { repo, git, preview } = fixture(t);
    const workspace = { id: "scratch", path: repo };
    const { working, staged } = arrange(git, repo);
    const index = readFileSync(join(repo, ".git/index"));
    const cached = (path: string) =>
      parseUnifiedDiff(git("diff", "--cached", "--no-renames", "HEAD", "--", path))[0]!.raw;
    const scratchIndex = join(repo, ".git", "scratch-index");
    writeFileSync(scratchIndex, index);
    const live = (path: string) =>
      execFileSync(
        "sh",
        ["-c", `git add -N -- "$1" && git diff --no-renames HEAD -- "$1"`, "-", path],
        {
          cwd: repo,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_INDEX_FILE: scratchIndex,
            GIT_CONFIG_NOSYSTEM: "1",
          },
        },
      );
    const expected = new Map<string, { source: PatchSource; raw: string }>([
      ...working.map(
        (path) =>
          [
            path,
            {
              source: "working-tree",
              raw: parseUnifiedDiff(live(path))[0]!.raw,
            },
          ] as const,
      ),
      ...staged.map((path) => [path, { source: "index", raw: cached(path) }] as const),
    ]);

    const listed = await preview();
    const listedReady = ready(listed);
    assert.deepEqual(
      listedReady.files.map((f) => [f.path, f.staged === true]),
      [...working.map((p) => [p, false]), ...staged.map((p) => [p, true])],
      name,
    );
    assert.deepEqual(
      parseUnifiedDiff(listedReady.diff).map((f) => f.path),
      [...expected.keys()],
      `${name}: each listed path has one patch in the full response`,
    );
    const sheet = changesSheet({
      observation: listed,
      busy: false,
      disclosure: initialDisclosure,
    });
    if (sheet.body.kind !== "files") throw new Error("Changes did not list files");
    for (const [path, { source, raw }] of expected) {
      const seeded: ReturnType<typeof changedFile> | undefined = sheet.body.files.find(
        (f) => f.metadata.path === path,
      )?.initial;
      assert.ok(seeded, `${name}: ${path} arrives with the list`);
      assert.equal(seeded.source, source, `${name}: ${path}`);
      assert.equal(seeded.file.raw, raw, `${name}: ${path} matches native Git`);
      assert.ok(askText(seeded).includes(raw), `${name}: ${path} Ask payload`);
      const loaded = changedFile(workspace, await preview(path), path, listedReady.comparison);
      assert.equal(loaded.source, source, `${name}: ${path} on expansion`);
      assert.equal(loaded.file.raw, raw, `${name}: ${path} on expansion matches native Git`);
      assert.ok(askText(loaded).includes(raw), `${name}: ${path} Ask payload on expansion`);
    }
    assert.deepEqual(readFileSync(join(repo, ".git/index")), index, `${name}: user's index`);
  }
});

test("local work: a branch or single-file read still reports staged-only and untracked edits elsewhere, leaving the index untouched", async (t) => {
  const { repo, git, read } = fixture(t);
  git("switch", "-qc", "main");
  writeFileSync(join(repo, "a"), "base\n");
  writeFileSync(join(repo, "b"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("switch", "-qc", "feature");
  writeFileSync(join(repo, "a"), "feature\n");
  git("commit", "-qam", "feature");
  const reads = [
    { scope: "branch", hints: { worktreeBase: { branch: "feature", base: "main" } } },
    { scope: "branch", hints: { worktreeBase: { branch: "feature", base: "main" } }, path: "a" },
    { scope: "uncommitted", path: "a" },
  ] as const;
  const uncommitted = async () => {
    const seen = [];
    for (const options of reads) seen.push(ready(await read(options)).local.uncommitted);
    return seen;
  };
  assert.deepEqual(await uncommitted(), [false, false, false]);

  writeFileSync(join(repo, "b"), "staged\n");
  git("add", "b");
  writeFileSync(join(repo, "b"), "base\n");
  assert.deepEqual(await uncommitted(), [true, true, true], "a staged-only edit");
  git("restore", "--staged", "b");

  writeFileSync(join(repo, "new"), "untracked\n");
  const index = readFileSync(join(repo, ".git/index"));
  assert.deepEqual(await uncommitted(), [true, true, true], "an untracked file");
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
  assert.equal(git("status", "--porcelain"), "?? new\n");
});

test("local work: commits not pushed count against the branch's upstream, not a same-named remote branch", async (t) => {
  const { git, preview } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("remote", "add", "origin", "https://github.com/example/repo.git");
  git("switch", "-qc", "feat");
  git("commit", "-q", "--allow-empty", "-m", "pushed");
  git("update-ref", "refs/remotes/origin/james/feat", "HEAD");
  git("update-ref", "refs/remotes/origin/feat", "main");
  git("config", "branch.feat.remote", "origin");
  git("config", "branch.feat.merge", "refs/heads/james/feat");
  git("config", "push.default", "upstream");
  git("commit", "-q", "--allow-empty", "-m", "local 1");
  git("commit", "-q", "--allow-empty", "-m", "local 2");
  assert.equal(ready(await preview()).local.commitsNotPushed, 2);
});

test("local work: a branch whose push ref Git does not hold counts no commits not pushed", async (t) => {
  const { git, preview } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("remote", "add", "origin", "https://github.com/example/repo.git");
  git("switch", "-qc", "feat");
  git("commit", "-q", "--allow-empty", "-m", "local");
  assert.equal(ready(await preview()).local.commitsNotPushed, null, "never pushed");
  git("update-ref", "refs/remotes/origin/feat", "main");
  assert.equal(ready(await preview()).local.commitsNotPushed, 1, "pushed, then committed");
});

test("a branch started from a remote branch compares and counts by its own name on that remote", async (t) => {
  const { git, read, preview } = fixture(t);
  git("switch", "-qc", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("branch", "-q", "release");
  git("remote", "add", "origin", "https://github.com/example/repo.git");
  git("update-ref", "refs/remotes/origin/main", "main");
  git("update-ref", "refs/remotes/origin/release", "release");
  git("config", "push.default", "simple");
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
  git("switch", "-qc", "feat", "--track", "upstream/main");
  writeFileSync(join(repo, "f"), "feat\n");
  git("add", "f");
  git("commit", "-qm", "feat");
  for (const [hints, from] of [
    [{ worktreeBase: { branch: "feat", base: "main" } }, "worktree"],
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

test("INV-01: Changes reads the pull request from the branch where its own worktree pushes it", async (t) => {
  const { repo, worktree } = forkWorktree(t);
  const fromBranch = async (headRepo: string) => {
    const { result } = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* WorkspaceChanges).preview(
          { id: "w", folder: repo, path: worktree },
          {
            scope: "uncommitted",
            hints: {
              pullRequest: { head: "feat", headRepo, base: "main", baseRepo: "up/repo" },
            },
          },
        );
      }).pipe(Effect.provide(WorkspaceChangesLive)),
    );
    assert.notEqual(result.status, "error", JSON.stringify(result));
    return result.status === "error" ? undefined : result.pullRequestFromBranch;
  };
  assert.equal(await fromBranch("me/fork"), true);
  assert.equal(await fromBranch("up/repo"), false, "origin's same-named branch is another");
});

test("INV-06: Changes honors the user's global core.excludesFile and nothing else from their config or inherited GIT_*", async (t) => {
  const { repo, git, preview } = fixture(t);
  writeFileSync(join(repo, "tracked"), "base\n");
  writeFileSync(join(repo, "secret.tracked"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const index = readFileSync(join(repo, ".git/index"));

  const home = mkdtempSync(join(tmpdir(), "piano-excludes-home-"));
  const decoy = mkdtempSync(join(tmpdir(), "piano-excludes-decoy-"));
  execFileSync("git", ["init", "-q", decoy]);
  mkdirSync(join(home, "custom"));
  writeFileSync(join(home, "custom/ignore"), "credentials.local\nsecret.tracked\n");
  writeFileSync(
    join(home, ".gitconfig"),
    [
      "[core]",
      "\texcludesFile = ~/custom/ignore",
      `\thooksPath = ${join(home, "hooks")}`,
      '[filter "trap"]',
      `\tclean = touch ${join(repo, "GLOBAL_FILTER_RAN")}; cat`,
      "\trequired = true",
      "[diff]",
      `\texternal = touch ${join(repo, "EXTERNAL_DIFF_RAN")}`,
      "",
    ].join("\n"),
  );
  writeFileSync(join(home, "redirect.gitconfig"), "[core]\n\texcludesFile = /dev/null\n");
  const inherited = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    GIT_DIR: join(decoy, ".git"),
    GIT_WORK_TREE: decoy,
    GIT_INDEX_FILE: join(decoy, ".git/index"),
    GIT_CONFIG_GLOBAL: join(home, "redirect.gitconfig"),
  };
  const saved = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
  Object.assign(process.env, inherited);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  });
  writeFileSync(join(repo, ".git/info/attributes"), "* filter=trap\n");

  const userGit = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      ),
    });
  writeFileSync(join(repo, "credentials.local"), "token=synthetic-not-a-secret\n");
  assert.equal(userGit("check-ignore", "credentials.local"), "credentials.local\n");
  assert.equal(
    userGit(
      "-c",
      "filter.trap.required=false",
      "-c",
      "filter.trap.clean=",
      "status",
      "--porcelain",
    ),
    "",
  );

  const quiet = ready(await preview());
  assert.deepEqual(quiet.files, []);
  assert.doesNotMatch(quiet.diff, /synthetic-not-a-secret/);
  assert.equal(quiet.local.uncommitted, false);
  const observation = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* WorkspaceChanges).written({ id: "scratch", folder: repo, path: repo }, [
        "credentials.local",
      ]);
    }).pipe(Effect.provide(WorkspaceChangesLive)),
  );
  assert.deepEqual(observation.result, {
    status: "ready",
    files: [{ path: "credentials.local", verdict: "ignored", placed: "credentials.local" }],
  });

  writeFileSync(join(repo, "notes.txt"), "ordinary\n");
  writeFileSync(join(repo, "secret.tracked"), "changed\n");
  const busy = ready(await preview());
  assert.deepEqual(busy.files.map((file) => file.path).sort(), ["notes.txt", "secret.tracked"]);
  assert.match(busy.diff, /\+changed/);
  assert.doesNotMatch(busy.diff, /synthetic-not-a-secret/);
  assert.equal(busy.local.uncommitted, true);

  for (const marker of ["GLOBAL_FILTER_RAN", "EXTERNAL_DIFF_RAN"])
    assert.equal(existsSync(join(repo, marker)), false);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
  assert.equal(execFileSync("git", ["-C", decoy, "ls-files"], { encoding: "utf8", env: {} }), "");
});
