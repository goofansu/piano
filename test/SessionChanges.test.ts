import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { type TestContext, test } from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { GitHubPullRequestsLive } from "../server/GitHubPullRequests.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionChanges, SessionChangesLive } from "../server/SessionChanges.ts";
import { SessionPullRequests, SessionPullRequestsLive } from "../server/SessionPullRequests.ts";
import { GhCommand } from "../server/Subprocess.ts";
import { WorkspaceChangesLive } from "../server/WorkspaceChanges.ts";
import type { WorkspaceChanges as Observation } from "../shared/wire.ts";

/** A folder on `main` with a worktree on `feature` Piano registered with its base, and a session there. */
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-session-changes-")),
    repo = join(root, "repo"),
    worktree = join(root, "repo.feature");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    ).trim();
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "a"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  git(repo, "branch", "-q", "release");
  git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
  writeFileSync(join(worktree, "a"), "edited\n");
  git(worktree, "commit", "-qam", "work");
  git(repo, "remote", "add", "origin", "https://github.com/example/repo.git");
  const forge = join(root, "forge.json"),
    gh = join(root, "gh");
  writeFileSync(
    gh,
    `#!${process.execPath}\nprocess.env.PIANO_TEST_GH_FIXTURE=${JSON.stringify(forge)};\nawait import(${JSON.stringify(resolvePath("test/fixtures/fake-gh.mjs"))});\n`,
    { mode: 0o755 },
  );
  const serve = (headRepo: string, baseRepo: string, base = "release") => {
    const [login, name] = headRepo.split("/");
    writeFileSync(
      forge,
      JSON.stringify({
        prs: [
          {
            url: `https://github.com/${baseRepo}/pull/7`,
            number: 7,
            title: "Work",
            state: "OPEN",
            isDraft: false,
            reviewDecision: null,
            statusCheckRollup: null,
            headRefName: "feature",
            baseRefName: base,
            headRepository: { name },
            headRepositoryOwner: { login },
          },
        ],
      }),
    );
  };
  const layer = Layer.merge(
    SessionChangesLive.pipe(Layer.provide(WorkspaceChangesLive)),
    SessionPullRequestsLive.pipe(Layer.provide(GitHubPullRequestsLive)),
  ).pipe(
    Layer.provideMerge(RegistryLive),
    Layer.provide([
      Layer.succeed(RegistryDatabasePath, join(root, "registry.db")),
      Layer.succeed(GhCommand, gh),
    ]),
  );
  const runtime = ManagedRuntime.make(layer);
  const registry = await runtime.runPromise(Registry);
  await runtime.runPromise(registry.addFolder(repo));
  await runtime.runPromise(
    registry.addWorktree({ folder: repo, path: worktree, branch: "feature", baseBranch: "main" }),
  );
  await runtime.runPromise(registry.addSession(worktree, "one"));
  await runtime.runPromise(registry.addSession(worktree, "two"));
  await runtime.runPromise(registry.addSession(repo, "root"));
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  // Stand in for the router: the workspace and session entry resolved by ID.
  const resolve = (cwd: string, sessionId: string) =>
    Effect.gen(function* () {
      const data = yield* registry.get;
      return {
        workspace: data.workspaces.find((w) => w.path === cwd)!,
        session: data.sessions.find((s) => s.cwd === cwd && s.sessionId === sessionId)!,
      };
    });
  const read = (cwd: string, sessionId: string, options?: { scope?: "branch" | "uncommitted" }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { workspace, session } = yield* resolve(cwd, sessionId);
        return yield* (yield* SessionChanges).read(workspace, session, options);
      }),
    );
  const setScope = (cwd: string, sessionId: string, scope: "branch" | "uncommitted" | null) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { workspace, session } = yield* resolve(cwd, sessionId);
        return yield* (yield* SessionChanges).setScope(workspace, session, scope);
      }),
    );
  const link = (baseRepo: string) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { session } = yield* resolve(worktree, "one");
        return yield* (yield* SessionPullRequests).change(session, {
          action: "link",
          url: `https://github.com/${baseRepo}/pull/7`,
        });
      }),
    );
  return { repo, worktree, git, runtime, registry, read, setScope, resolve, serve, link };
}

function ready(value: Observation) {
  assert.equal(value.result.status, "ready", JSON.stringify(value.result));
  if (value.result.status !== "ready") throw new Error("Read failed");
  return value.result;
}

test("a session's Changes compare its worktree with the base Piano recorded, keep committed work, and follow a linked pull request's base", async (t) => {
  const f = await fixture(t);
  const branch = ready(await f.setScope(f.worktree, "one", "branch"));
  assert.equal(branch.comparison.scope, "branch");
  assert.deepEqual(
    [branch.comparison.target?.name, branch.comparison.target?.from],
    ["main", "worktree"],
  );
  assert.deepEqual(
    branch.files.map((file) => file.path),
    ["a"],
  );
  assert.deepEqual(ready(await f.read(f.worktree, "one", { scope: "uncommitted" })).files, []);
  // A qualified same-repository PR can select its locally held remote base.
  f.git(f.repo, "update-ref", "refs/remotes/origin/release", "release");
  await f.runtime.runPromise(
    Effect.gen(function* () {
      const { session } = yield* f.resolve(f.worktree, "one");
      yield* f.registry.setSessionLink(session, "pullRequest", {
        url: "https://github.com/example/repo/pull/1",
        source: "branch",
        head: "feature",
        base: "release",
        headRepo: "example/repo",
        baseRepo: "example/repo",
      });
    }),
  );
  const fromPr = ready(await f.read(f.worktree, "one"));
  assert.deepEqual(
    [fromPr.comparison.target?.name, fromPr.comparison.target?.from],
    ["release", "pull-request"],
  );
  // On the folder's root, main is the target itself: explicit Branch still says why.
  assert.equal(ready(await f.read(f.repo, "root")).comparison.scope, "uncommitted");
  const refused = await f.read(f.repo, "root", { scope: "branch" });
  assert.equal(refused.result.status, "unavailable");
});

test("INV-01/07: a manual foreign PR with the same head name stays linked without hiding branch changes", async (t) => {
  const f = await fixture(t);
  f.git(f.repo, "branch", "-f", "release", "feature");
  f.git(f.repo, "update-ref", "refs/remotes/origin/release", "feature");
  const before = ready(await f.setScope(f.worktree, "one", "branch"));
  assert.deepEqual(
    before.files.map((file) => file.path),
    ["a"],
  );
  f.serve("other/repo", "other/repo");
  const linked = await f.link("other/repo");
  assert.equal(linked.link?.source, "manual");
  assert.equal(linked.pullRequest?.repo, "other/repo");
  const after = ready(await f.read(f.worktree, "one"));
  assert.deepEqual(
    after.files.map((file) => file.path),
    ["a"],
  );
  assert.deepEqual(after.comparison, before.comparison);
});

test("INV-01/07: a fork PR uses only its base repository's locally held remote ref", async (t) => {
  const f = await fixture(t);
  // Use the branch's tracking repository, not a hard-coded origin. Remote URL rewrites are
  // Git's policy too; only this test's isolated HOME supplies them.
  const home = mkdtempSync(join(tmpdir(), "piano-comparison-home-"));
  const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, "config") });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  writeFileSync(
    join(home, ".gitconfig"),
    '[url "https://github.int.exe.xyz/"]\n\tinsteadOf = parent:\n',
  );
  f.git(f.repo, "remote", "rename", "origin", "fork");
  f.git(f.repo, "remote", "add", "origin", "https://github.com/other/repo.git");
  f.git(f.repo, "update-ref", "refs/remotes/fork/feature", "feature");
  f.git(f.worktree, "branch", "--set-upstream-to=fork/feature");
  // Colliding names in the fork/local checkout must never stand in for the upstream base.
  f.git(f.repo, "branch", "-f", "release", "feature");
  f.git(f.repo, "update-ref", "refs/remotes/fork/release", "feature");
  f.serve("example/repo", "upstream/repo");
  const linked = await f.link("upstream/repo");
  assert.deepEqual(
    [linked.link?.headRepo, linked.link?.baseRepo],
    ["example/repo", "upstream/repo"],
  );
  const read = async () => ready(await f.read(f.worktree, "one", { scope: "branch" }));
  assert.equal((await read()).comparison.target?.from, "worktree", "no matching base remote");
  f.git(f.repo, "remote", "add", "parent", "parent:upstream/repo.git");
  assert.equal(
    (await read()).comparison.target?.from,
    "worktree",
    "matching remote but no held base ref",
  );
  f.git(f.repo, "update-ref", "refs/remotes/parent/release", "main");
  const fork = await read();
  assert.equal(fork.comparison.target?.ref, "refs/remotes/parent/release");
  assert.equal(fork.comparison.target?.from, "pull-request");
  assert.deepEqual(
    fork.files.map((file) => file.path),
    ["a"],
  );
});

test("legacy links do not retarget until a successful refresh proves repository identities", async (t) => {
  const f = await fixture(t);
  f.git(f.repo, "update-ref", "refs/remotes/origin/release", "release");
  await f.runtime.runPromise(
    Effect.gen(function* () {
      const { session } = yield* f.resolve(f.worktree, "one");
      yield* f.registry.setSessionLink(session, "pullRequest", {
        url: "https://github.com/example/repo/pull/7",
        source: "manual",
        head: "feature",
        base: "release",
      });
    }),
  );
  const read = async () => ready(await f.read(f.worktree, "one", { scope: "branch" }));
  assert.equal((await read()).comparison.target?.from, "worktree");
  f.serve("example/repo", "example/repo");
  await f.runtime.runPromise(
    Effect.gen(function* () {
      const { session } = yield* f.resolve(f.worktree, "one");
      yield* (yield* SessionPullRequests).get(session);
    }),
  );
  const refreshed = await read();
  assert.equal(refreshed.comparison.target?.ref, "refs/remotes/origin/release");
  assert.equal(refreshed.comparison.target?.from, "pull-request");
  assert.deepEqual(
    refreshed.files.map((file) => file.path),
    ["a"],
  );
});

test("Uncommitted is the default; a saved branch choice overrides it only for that session", async (t) => {
  const f = await fixture(t);
  const initial = ready(await f.read(f.worktree, "one"));
  assert.equal(initial.comparison.scope, "uncommitted");
  assert.deepEqual(initial.files, []);
  assert.equal(initial.scopes.find((scope) => scope.scope === "branch")?.available, true);
  assert.equal(ready(await f.setScope(f.worktree, "one", "branch")).comparison.scope, "branch");
  assert.equal(ready(await f.read(f.worktree, "one")).comparison.scope, "branch");
  assert.equal(ready(await f.read(f.worktree, "two")).comparison.scope, "uncommitted");
  const saved = (await f.runtime.runPromise(f.registry.get)).sessions.find(
    (s) => s.sessionId === "one",
  );
  assert.equal(saved?.changesScope, "branch");
  // A read may still ask for another scope without changing the saved one.
  assert.equal(
    ready(await f.read(f.worktree, "one", { scope: "uncommitted" })).comparison.scope,
    "uncommitted",
  );
  assert.equal(ready(await f.read(f.worktree, "one")).comparison.scope, "branch");
  assert.equal(ready(await f.setScope(f.worktree, "one", null)).comparison.scope, "uncommitted");
  const cleared = (await f.runtime.runPromise(f.registry.get)).sessions.find(
    (s) => s.sessionId === "one",
  );
  assert.equal(cleared?.changesScope, undefined);
  // A saved scope the checkout cannot read is refused, never swapped for another.
  await f
    .setScope(f.repo, "root", "branch")
    .then((value) => assert.equal(value.result.status, "unavailable"));
  assert.equal((await f.read(f.repo, "root")).result.status, "unavailable");
});

test("local work shows whatever the scope, even one the checkout cannot read", async (t) => {
  const f = await fixture(t);
  const unavailable = (value: Observation) => {
    assert.equal(value.result.status, "unavailable", JSON.stringify(value.result));
    if (value.result.status !== "unavailable") throw new Error("Read was not refused");
    return value.result;
  };
  // On the base branch itself, the branch scope has nothing to compare with.
  assert.deepEqual(unavailable(await f.read(f.repo, "root", { scope: "branch" })).local, {
    commitsNotPushed: null,
    uncommitted: false,
  });
  writeFileSync(join(f.repo, "new"), "untracked\n");
  const local = unavailable(await f.read(f.repo, "root", { scope: "branch" })).local;
  assert.equal(local.uncommitted, true, "an untracked file is an edit not committed");
  assert.deepEqual(ready(await f.read(f.repo, "root")).local, local);
});
