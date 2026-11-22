import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  Registry,
  RegistryDatabasePath,
  RegistryLive,
} from "../../../../server/shared/registry/Registry.ts";
import { GhCommand } from "../../../../server/shared/Subprocess.ts";
import { seedRegistry } from "../../../../test/shared/registry.ts";
import type { WorkspaceChanges as Observation } from "../../contracts/changes/http.ts";
import { SessionChanges, SessionChangesLive } from "../../server/changes/SessionChanges.ts";
import { WorkspaceChangesLive } from "../../server/changes/WorkspaceChanges.ts";
import { worktreeInstance } from "../../server/GitCheckout.ts";
import { GitHubPullRequestsLive } from "../../server/pull-requests/GitHubPullRequests.ts";
import {
  SessionPullRequests,
  SessionPullRequestsLive,
} from "../../server/pull-requests/SessionPullRequests.ts";

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
  const createdAt = git(worktree, "rev-parse", "HEAD");
  writeFileSync(join(worktree, "a"), "edited\n");
  git(worktree, "commit", "-qam", "work");
  git(repo, "remote", "add", "origin", "https://github.com/example/repo.git");
  const forge = join(root, "forge.json"),
    gh = join(root, "gh");
  writeFileSync(
    gh,
    `#!${process.execPath}\nprocess.env.PIANO_TEST_GH_FIXTURE=${JSON.stringify(forge)};\nawait import(${JSON.stringify(resolvePath("test/shared/fake-gh.mjs"))});\n`,
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
    registry.recordCreatedWorktree({
      folder: repo,
      path: worktree,
      branch: "feature",
      baseBranch: "main",
      commit: createdAt,
      instance: await worktreeInstance(git(worktree, "rev-parse", "--absolute-git-dir")),
    }),
  );
  await runtime.runPromise(registry.addSession(worktree, "one"));
  await runtime.runPromise(registry.addSession(worktree, "two"));
  await runtime.runPromise(registry.addSession(repo, "root"));
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });
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
  const discover = () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { session } = yield* resolve(worktree, "one");
        return yield* (yield* SessionPullRequests).change(session, { action: "discover" });
      }),
    );
  return { repo, worktree, git, runtime, registry, read, setScope, resolve, serve, link, discover };
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
  assert.equal(ready(await f.read(f.repo, "root")).comparison.scope, "uncommitted");
  const refused = await f.read(f.repo, "root", { scope: "branch" });
  assert.equal(refused.result.status, "unavailable");
});

test("a worktree's recorded base applies only while the checkout is on the branch it was recorded with", async (t) => {
  const f = await fixture(t);
  const target = async () => {
    const { comparison } = ready(await f.read(f.worktree, "one", { scope: "branch" }));
    return [comparison.target?.name, comparison.target?.from];
  };
  assert.deepEqual(await target(), ["main", "worktree"]);
  const observe = (branch: string) =>
    f.runtime.runPromise(f.registry.observeWorktreeBranches([{ path: f.worktree, branch }]));
  f.git(f.worktree, "switch", "-q", "-c", "other");
  assert.deepEqual(await target(), ["main", "assumed"]);
  await observe("other");
  assert.deepEqual(await target(), ["main", "assumed"]);
  f.git(f.worktree, "switch", "-q", "feature");
  assert.deepEqual(await target(), ["main", "worktree"]);
  await observe("feature");
  assert.deepEqual(await target(), ["main", "worktree"]);
});

test("PIN-167: a schema-17 base observed on another branch is not assigned to that branch on upgrade", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-legacy-base-")),
    repo = join(root, "repo"),
    worktree = join(root, "repo.feature"),
    database = join(root, "registry.db");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    ).trim();
  const commitFile = (cwd: string, name: string) => {
    writeFileSync(join(cwd, name), `${name}\n`);
    git(cwd, "add", name);
    git(cwd, "commit", "-qm", name);
  };
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  commitFile(repo, "base");
  git(repo, "branch", "-q", "release");
  commitFile(repo, "main-only");
  git(repo, "switch", "-q", "release");
  commitFile(repo, "release-only");
  git(repo, "switch", "-q", "main");
  git(repo, "worktree", "add", "-q", "-b", "feature", worktree, "release");
  commitFile(worktree, "feature-work");
  git(worktree, "switch", "-q", "-c", "other", "main");
  commitFile(worktree, "other-work");

  seedRegistry(database, {
    folders: [repo],
    worktrees: [{ folder: repo, path: worktree, branch: "other" }],
    sessions: [{ cwd: worktree, sessionId: "s", createdAt: "then", updatedAt: "now" }],
  });
  const legacy = new DatabaseSync(database);
  try {
    legacy.exec(
      `ALTER TABLE worktrees DROP COLUMN created_commit; ALTER TABLE worktrees DROP COLUMN created_branch; UPDATE worktrees SET base_branch = 'release'; PRAGMA user_version = 17;`,
    );
  } finally {
    legacy.close();
  }

  const open = (t: TestContext) => {
    const runtime = ManagedRuntime.make(
      SessionChangesLive.pipe(
        Layer.provide(WorkspaceChangesLive),
        Layer.provideMerge(RegistryLive),
        Layer.provide(Layer.succeed(RegistryDatabasePath, database)),
      ),
    );
    t.after(() => runtime.dispose());
    return () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const data = yield* (yield* Registry).get;
          const workspace = data.workspaces.find((w) => w.path === worktree)!;
          const session = data.sessions.find((s) => s.cwd === worktree)!;
          const { comparison, files } = ready(
            yield* (yield* SessionChanges).read(workspace, session, { scope: "branch" }),
          );
          return {
            target: [comparison.target?.name, comparison.target?.from],
            files: files.map((file) => file.path).sort(),
          };
        }),
      );
  };
  const read = open(t);
  assert.deepEqual(await read(), { target: ["main", "assumed"], files: ["other-work"] });
  git(worktree, "switch", "-q", "feature");
  assert.deepEqual(await read(), {
    target: ["main", "assumed"],
    files: ["feature-work", "release-only"],
  });
  git(worktree, "switch", "-q", "other");
  assert.deepEqual(await open(t)(), { target: ["main", "assumed"], files: ["other-work"] });
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

for (const host of ["github.com", "github.int.exe.xyz"] as const)
  for (const [layout, fork, extra] of [
    ["a fork tracked at a remote named -fork", "-fork", []],
    ["a fork at origin beside a remote named -archive", "origin", ["-archive"]],
  ] as const)
    test(`${host}: with ${layout}, discovery and both Changes scopes reach the upstream base`, async (t) => {
      const f = await fixture(t);
      f.git(f.repo, "remote", "remove", "origin");
      f.git(f.repo, "remote", "add", "--", fork, `https://${host}/me/fork.git`);
      f.git(f.repo, "remote", "add", "parent", `https://${host}/up/repo.git`);
      for (const name of extra)
        f.git(f.repo, "remote", "add", "--", name, "https://git.example/archive/repo.git");
      f.git(f.repo, "update-ref", `refs/remotes/${fork}/feature`, "feature");
      f.git(f.worktree, "branch", `--set-upstream-to=${fork}/feature`);
      f.git(f.repo, "update-ref", "refs/remotes/parent/release", "main");
      f.serve("me/fork", "up/repo");
      const found = await f.discover();
      assert.equal(found.error, undefined);
      assert.equal(found.pullRequest?.number, 7, JSON.stringify(found));
      assert.deepEqual([found.link?.headRepo, found.link?.baseRepo], ["me/fork", "up/repo"]);
      for (const scope of ["branch", "uncommitted"] as const) {
        const changes = ready(await f.read(f.worktree, "one", { scope }));
        assert.equal(changes.comparison.scope, scope);
        if (scope === "branch") {
          assert.equal(changes.comparison.target?.ref, "refs/remotes/parent/release");
          assert.equal(changes.comparison.target?.from, "pull-request");
          assert.deepEqual(
            changes.files.map((file) => file.path),
            ["a"],
          );
        }
      }
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
  assert.deepEqual(unavailable(await f.read(f.repo, "root", { scope: "branch" })).local, {
    commitsNotPushed: null,
    uncommitted: false,
  });
  writeFileSync(join(f.repo, "new"), "untracked\n");
  const local = unavailable(await f.read(f.repo, "root", { scope: "branch" })).local;
  assert.equal(local.uncommitted, true, "an untracked file is an edit not committed");
  assert.deepEqual(ready(await f.read(f.repo, "root")).local, local);
});
