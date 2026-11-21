import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { PianoCoreLive } from "../../../../server/app/PianoServices.ts";
import { SidebarView } from "../../../../server/features/navigation/SidebarView.ts";
import {
  SessionChanges,
  SessionChangesLive,
} from "../../../../server/features/workspace/changes/SessionChanges.ts";
import { WorkspaceChangesLive } from "../../../../server/features/workspace/changes/WorkspaceChanges.ts";
import { FolderWorktrees } from "../../../../server/features/workspace/worktrees/FolderWorktrees.ts";
import {
  checkoutHint,
  createWorktree,
  listWorktrees,
} from "../../../../server/features/workspace/worktrees/Worktrees.ts";
import { worktreeInstance } from "../../../../server/shared/GitCheckout.ts";
import { Registry, RegistryDatabasePath } from "../../../../server/shared/registry/Registry.ts";
import { forkWorktree } from "../../../fixtures/forkWorktree.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
function fixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-worktrees-")),
    repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "baseline",
  );
  t.after(() => {
    for (const line of git(repo, "worktree", "list", "--porcelain").split("\n")) {
      if (line.startsWith("worktree ") && line.slice(9) !== repo)
        git(repo, "worktree", "remove", "--force", line.slice(9));
    }
    for (const branch of git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads").split(
      "\n",
    )) {
      if (branch && branch !== "main") git(repo, "branch", "-D", branch);
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, repo };
}
test("INV-06: discovery reads Git worktrees and reports failures without healthy fallbacks", async (t) => {
  const { root, repo } = fixture(t);
  git(repo, "worktree", "add", "--quiet", "-b", "feature", join(root, "feature"));
  git(repo, "worktree", "add", "--quiet", "--detach", join(root, "detached"));
  git(repo, "worktree", "add", "--quiet", "-b", "gone", join(root, "gone"));
  rmSync(join(root, "gone"), { recursive: true, force: true });
  const observe = (path: string) => Effect.runPromise(listWorktrees(path));
  const result = await observe(repo);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.currentPath, repo);
  assert.deepEqual(
    result.worktrees,
    [
      { path: repo, branch: "main", detached: false, prunable: false },
      { path: join(root, "detached"), branch: null, detached: true, prunable: false },
      { path: join(root, "feature"), branch: "feature", detached: false, prunable: false },
      { path: join(root, "gone"), branch: "gone", detached: false, prunable: true },
    ]
      .map((w) => ({ ...w, head: git(repo, "rev-parse", "HEAD") }))
      .sort((x, y) => (x.path === repo ? -1 : y.path === repo ? 1 : x.path.localeCompare(y.path))),
  );
  mkdirSync(join(repo, "subdirectory"));
  const subdir = await observe(join(repo, "subdirectory"));
  assert.ok(subdir.status === "ready" && subdir.currentPath === repo);
  const linked = await observe(join(root, "feature"));
  assert.ok(linked.status === "ready" && linked.currentPath === join(root, "feature"));
  const nonGit = join(root, "notes");
  mkdirSync(nonGit);
  assert.equal((await observe(nonGit)).status, "non-git");
  writeFileSync(join(nonGit, ".git"), "gitdir: /not/a/repository\n");
  const broken = await observe(nonGit);
  assert.equal(broken.status, "error");
  assert.equal("worktrees" in broken, false);
});

test("discovery exposes only GitHub repository identity from origin, including linked worktrees", async (t) => {
  const { root, repo } = fixture(t);
  const linked = join(root, "feature");
  git(repo, "worktree", "add", "--quiet", "-b", "feature/links", linked);
  const repository = async (path: string) => {
    const result = await Effect.runPromise(listWorktrees(path));
    assert.equal(result.status, "ready");
    return result.status === "ready" ? result.githubRepo : undefined;
  };
  assert.equal(await repository(repo), undefined);
  git(repo, "remote", "add", "origin", "git@github.com:Example/Repo.git");
  assert.equal(await repository(repo), "example/repo");
  assert.equal(await repository(linked), "example/repo");
  git(repo, "remote", "set-url", "origin", "https://github.com/other/project.git");
  assert.equal(await repository(repo), "other/project");
  git(repo, "remote", "set-url", "origin", "https://gitlab.com/example/repo.git");
  assert.equal(await repository(repo), undefined);
  git(repo, "remote", "set-url", "origin", "https://user:password@github.com/example/repo.git");
  assert.equal(await repository(repo), undefined);
});

test("discovery names each worktree's branch where it was pushed on GitHub, and nothing before", async (t) => {
  const { root, repo } = fixture(t);
  git(repo, "remote", "add", "origin", "git@github.com:Example/Repo.git");
  git(repo, "remote", "add", "fork", "https://github.com/me/repo.git");
  git(repo, "update-ref", "refs/remotes/origin/feature/x", "HEAD");
  git(repo, "config", "push.default", "upstream");
  const add = (name: string, branch: string, ...start: string[]) =>
    git(repo, "worktree", "add", "--quiet", "-b", branch, join(root, name), ...start);
  add("draft", "draft");
  add("plain", "plain");
  git(repo, "update-ref", "refs/remotes/origin/plain", "HEAD");
  add("forked", "forked");
  git(repo, "config", "branch.forked.pushRemote", "fork");
  git(repo, "update-ref", "refs/remotes/fork/forked", "HEAD");
  git(repo, "update-ref", "refs/remotes/origin/forked", "HEAD");
  add("renamed", "local-fix", "--track", "origin/feature/x");
  git(repo, "update-ref", "refs/remotes/origin/local-fix", "HEAD");
  const homes = async () => {
    const result = await Effect.runPromise(listWorktrees(repo));
    assert.equal(result.status, "ready");
    return Object.fromEntries(
      (result.status === "ready" ? result.worktrees : []).map((w) => [w.branch, w.github]),
    );
  };
  assert.deepEqual(await homes(), {
    main: undefined,
    draft: undefined,
    plain: { repo: "example/repo", branch: "plain" },
    forked: { repo: "me/repo", branch: "forked" },
    "local-fix": { repo: "example/repo", branch: "feature/x" },
  });
  git(repo, "config", "remote.pushDefault", "fork");
  git(repo, "config", "--unset", "branch.forked.pushRemote");
  const forked = await homes();
  assert.deepEqual(forked.forked, { repo: "me/repo", branch: "forked" });
  assert.equal(forked.plain, undefined);
  assert.equal(forked.draft, undefined);
  git(repo, "remote", "set-url", "--push", "fork", "git@github.com:me/pushed.git");
  assert.deepEqual((await homes()).forked, { repo: "me/pushed", branch: "forked" });
});

test("INV-01: a worktree's branch is linked where that worktree's own config pushes it", async (t) => {
  const { repo, worktree } = forkWorktree(t);
  const result = await Effect.runPromise(listWorktrees(repo));
  assert.equal(result.status, "ready");
  const linked = (result.status === "ready" ? result.worktrees : []).find(
    (w) => w.path === worktree,
  );
  assert.deepEqual(linked?.github, { repo: "me/fork", branch: "feat" });
});

test("INV-06: inherited GIT_* state cannot redirect discovery or directory hints", async (t) => {
  const { root, repo } = fixture(t);
  git(repo, "worktree", "add", "--quiet", "-b", "feature", join(root, "feature"));
  const other = join(root, "other");
  mkdirSync(other);
  git(other, "init", "--quiet", "-b", "elsewhere");
  git(
    other,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "redirected",
  );
  const inherited = {
    GIT_DIR: join(other, ".git"),
    GIT_WORK_TREE: other,
    GIT_COMMON_DIR: join(other, ".git"),
  };
  const saved = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
  Object.assign(process.env, inherited);
  try {
    const result = await Effect.runPromise(listWorktrees(repo));
    assert.ok(result.status === "ready", JSON.stringify(result));
    assert.equal(result.currentPath, repo);
    assert.deepEqual(result.worktrees.map((w) => w.branch).sort(), ["feature", "main"]);
    assert.deepEqual(await Effect.runPromise(checkoutHint(repo)), {
      root: repo,
      subject: "baseline",
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("INV-06/INV-07: creation uses configured checkout filters and ignores inherited Git redirection and setup hooks", async (t) => {
  const { root, repo } = fixture(t);
  const { repo: other } = fixture(t);
  const configHome = join(root, "config");
  mkdirSync(join(configHome, "git"), { recursive: true });
  const config = join(configHome, "git", "config");
  git(repo, "config", "--file", config, "filter.piano-test.smudge", "tr a-z A-Z");
  git(repo, "config", "--file", config, "core.hooksPath", root);
  writeFileSync(join(root, "post-checkout"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(repo, ".gitattributes"), "identity filter=piano-test\n");
  git(repo, "add", ".gitattributes");
  for (const [path, identity] of [
    [repo, "requested"],
    [other, "unrelated"],
  ]) {
    writeFileSync(join(path, "identity"), identity);
    git(path, "add", "identity");
    git(
      path,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      identity,
    );
  }
  const before = {
    head: git(other, "rev-parse", "HEAD"),
    branches: git(other, "for-each-ref", "refs/heads"),
    worktrees: git(other, "worktree", "list", "--porcelain"),
  };
  const inherited = {
    XDG_CONFIG_HOME: configHome,
    GIT_DIR: join(other, ".git"),
    GIT_WORK_TREE: other,
    GIT_COMMON_DIR: join(other, ".git"),
    GIT_INDEX_FILE: join(other, ".git", "index"),
    GIT_OBJECT_DIRECTORY: join(other, ".git", "objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(root, "missing-objects"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.bare",
    GIT_CONFIG_VALUE_0: "true",
    GIT_CONFIG_GLOBAL: join(root, "missing-config"),
  };
  const saved = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
  Object.assign(process.env, inherited);
  try {
    const created = await Effect.runPromise(createWorktree(repo, "requested-branch"));
    assert.equal(
      git(created.path, "rev-parse", "--path-format=absolute", "--git-common-dir"),
      join(repo, ".git"),
    );
    assert.equal(git(created.path, "rev-parse", "HEAD"), git(repo, "rev-parse", "HEAD"));
    assert.equal(readFileSync(join(created.path, "identity"), "utf8"), "REQUESTED");
    assert.equal(created.path, `${repo}.requested-branch`);
    assert.equal(git(repo, "rev-parse", "requested-branch"), git(repo, "rev-parse", "HEAD"));
    assert.ok(git(repo, "worktree", "list", "--porcelain").includes(`worktree ${created.path}\n`));
    assert.deepEqual(
      {
        head: git(other, "rev-parse", "HEAD"),
        branches: git(other, "for-each-ref", "refs/heads"),
        worktrees: git(other, "worktree", "list", "--porcelain"),
      },
      before,
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("INV-06: creation puts a new branch beside the main checkout on the default branch, and a refusal leaves no checkout or branch", async (t) => {
  const { repo } = fixture(t);
  const create = (folder: string, branch: string) =>
    Effect.runPromise(createWorktree(folder, branch).pipe(Effect.result));
  const made = async (folder: string, branch: string) => {
    const result = await create(folder, branch);
    assert.equal(result._tag, "Success", JSON.stringify(result));
    if (result._tag !== "Success") throw new Error("Creation failed");
    return result.success;
  };
  const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];
  git(repo, "checkout", "--quiet", "-b", "release");
  git(repo, ...identity, "commit", "--quiet", "--allow-empty", "-m", "release");
  git(repo, "checkout", "--quiet", "-b", "elsewhere");

  git(repo, "tag", "main", "release");
  const first = await made(repo, "feat/one");
  assert.deepEqual(first, { path: `${repo}.feat-one`, branch: "feat/one", baseBranch: "main" });
  assert.equal(git(first.path, "rev-parse", "HEAD"), git(repo, "rev-parse", "refs/heads/main"));
  git(repo, "tag", "-d", "main");
  assert.equal(git(first.path, "symbolic-ref", "--short", "HEAD"), "feat/one");

  const nested = await made(first.path, "two");
  assert.equal(nested.path, `${repo}.two`, "a linked checkout creates beside the main checkout");

  git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/release");
  const remote = await made(repo, "three");
  assert.equal(remote.baseBranch, "release");
  assert.equal(git(remote.path, "rev-parse", "HEAD"), git(repo, "rev-parse", "release"));

  mkdirSync(`${repo}.taken`);
  const before = {
    branches: git(repo, "for-each-ref", "refs/heads"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };
  for (const [branch, detail] of [
    ["two", /already exists/],
    ["taken", /already exists/],
    ["-b", /valid new branch name/],
    [" spaced", /valid new branch name/],
    ["@", /literal new branch name/],
  ] as const) {
    const result = await create(repo, branch);
    assert.equal(result._tag, "Failure", branch);
    if (result._tag === "Failure") {
      assert.match(result.failure.detail, detail, branch);
      assert.notEqual(result.failure.unconfirmed, true, branch);
    }
  }
  assert.deepEqual(
    {
      branches: git(repo, "for-each-ref", "refs/heads"),
      worktrees: git(repo, "worktree", "list", "--porcelain"),
    },
    before,
  );
  git(repo, "checkout", "--quiet", "main");
});

test("INV-06: creation without a remote default, main or master starts from the main checkout's branch", async (t) => {
  const { repo } = fixture(t);
  git(repo, "branch", "-m", "main", "trunk");
  git(repo, "tag", "trunk");
  const created = await Effect.runPromise(createWorktree(repo, "topic"));
  assert.equal(created.baseBranch, "trunk");
  git(repo, "tag", "-d", "trunk");
  git(repo, "worktree", "remove", "--force", created.path);
  git(repo, "branch", "-D", "topic");
  git(repo, "checkout", "--quiet", "--detach");
  const failed = await Effect.runPromise(createWorktree(repo, "topic").pipe(Effect.flip));
  assert.match(failed.detail, /No base branch found/);
  git(repo, "checkout", "--quiet", "trunk");
  git(repo, "branch", "-m", "trunk", "main");
});

test("INV-06: a created worktree detached or removed outside Piano, and an unreadable repository, show as observed", async (t) => {
  const { root, repo } = fixture(t);
  const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e);
  const created = await run(createWorktree(repo, "feature"));
  assert.equal(created.path, `${repo}.feature`);
  assert.equal(created.baseBranch, "main");
  writeFileSync(join(created.path, "new-source.ts"), "export const x = 1;\n");
  git(created.path, "checkout", "--quiet", "--detach");
  let observed = await run(listWorktrees(repo));
  assert.equal(observed.status, "ready");
  if (observed.status === "ready") {
    const w = observed.worktrees.find((w) => w.path === created.path)!;
    assert.equal(w.branch, null);
    assert.equal(w.detached, true);
  }
  const layer = PianoCoreLive({ idleMs: 0 }).pipe(Layer.provide(NodeServices.layer));
  await Effect.runPromise(
    Effect.gen(function* () {
      const sidebar = yield* SidebarView;
      const buildFolders = Effect.map(sidebar.fresh, (view) => view.folders);
      const references = Effect.map(sidebar.fresh, (view) => view.sessionReferences ?? []);
      const registry = yield* Registry;
      yield* registry.addFolder(repo);
      yield* registry.addWorktree({
        folder: repo,
        path: created.path,
        branch: "old-registry-branch",
      });
      yield* registry.addSession(created.path, "saved-history");
      let view = (yield* buildFolders)[0];
      assert.equal(view.worktrees.length, 2);
      assert.equal(view.worktrees[1].branch, null);
      assert.equal(view.worktrees[1].facts?.detached, true);
      let [saved] = yield* references;
      assert.equal(saved?.workspaceId, view.worktrees[1].workspace.id);
      assert.equal(saved?.branch, null);
      git(repo, "worktree", "remove", "--force", created.path);
      view = (yield* buildFolders)[0];
      assert.equal(view.worktrees[1].status, "missing");
      [saved] = yield* references;
      assert.equal(saved?.sessionId, "saved-history");
      chmodSync(join(repo, ".git"), 0o000);
      try {
        view = (yield* buildFolders)[0];
      } finally {
        chmodSync(join(repo, ".git"), 0o755);
      }
      assert.equal(view.discovery.status, "error");
      assert.equal(view.worktrees[0].status, "unknown");
      assert.equal(view.worktrees[0].branch, null);
      assert.equal((yield* references).length, 1);
      const data = yield* registry.get;
      assert.equal(data.worktrees[0].branch, "old-registry-branch");
      assert.equal(data.worktrees.length, 1);
      assert.equal(data.sessions.length, 1);
    }).pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(RegistryDatabasePath, join(root, "registry.db")),
    ),
  );
});

function branchChangesHarness(t: TestContext) {
  const { root, repo } = fixture(t);
  const commit = (cwd: string, message: string) =>
    git(
      cwd,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      message,
    );
  git(repo, "checkout", "--quiet", "-b", "release");
  writeFileSync(join(repo, "release-only.txt"), "release\n");
  git(repo, "add", ".");
  commit(repo, "release");
  git(repo, "checkout", "--quiet", "main");
  const setDefault = (branch: string) =>
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branch}`);

  const layer = SessionChangesLive.pipe(
    Layer.provideMerge(WorkspaceChangesLive),
    Layer.provideMerge(PianoCoreLive({ idleMs: 0 })),
    Layer.provide(NodeServices.layer),
  );
  const run = <A, E>(work: Effect.Effect<A, E, Layer.Success<typeof layer>>) =>
    Effect.runPromise(
      work.pipe(
        Effect.scoped,
        Effect.provide(layer),
        Effect.provideService(RegistryDatabasePath, join(root, "registry.db")),
      ),
    );
  const create = (branch: string) =>
    Effect.flatMap(FolderWorktrees, (worktrees) => worktrees.create(repo, branch));
  const branchChanges = (cwd: string, sessionId: string) =>
    Effect.gen(function* () {
      const data = yield* (yield* Registry).get;
      const workspace = data.workspaces.find((w) => w.path === cwd)!;
      const session = data.sessions.find((s) => s.cwd === cwd && s.sessionId === sessionId)!;
      const { result } = yield* (yield* SessionChanges).read(workspace, session, {
        scope: "branch",
      });
      assert.equal(result.status, "ready", JSON.stringify(result));
      if (result.status !== "ready") throw new Error("Changes failed");
      return {
        target: [result.comparison.target?.name, result.comparison.target?.from],
        files: result.files.map((f) => f.path),
      };
    });
  const recorded = (path: string) =>
    Effect.map(
      Effect.flatMap(Registry, (r) => r.get),
      (d) => d.worktrees.find((w) => w.path === path),
    );

  return { root, repo, commit, setDefault, run, create, branchChanges, recorded };
}

test("INV-06: recreating a worktree at its old path from another base records the new base for Branch Changes, and a branch made outside Piano, even under the same name, does not use it", async (t) => {
  const { repo, commit, setDefault, run, create, branchChanges, recorded } =
    branchChangesHarness(t);
  const first = await run(
    Effect.gen(function* () {
      yield* (yield* Registry).addFolder(repo);
      const first = yield* create("topic");
      assert.equal(first.baseBranch, "main");
      yield* (yield* Registry).addSession(first.path, "before-recreation");
      return {
        path: first.path,
        workspaceId: (yield* (yield* Registry).get).workspaces.find((w) => w.path === first.path)!
          .id,
      };
    }),
  );
  git(repo, "worktree", "remove", "--force", first.path);
  git(repo, "branch", "-D", "topic");
  setDefault("release");
  await run(
    Effect.gen(function* () {
      const again = yield* create("topic");
      assert.equal(again.path, first.path);
      assert.equal(again.baseBranch, "release");
    }),
  );
  setDefault("main");
  const instance = await worktreeInstance(git(first.path, "rev-parse", "--absolute-git-dir"));

  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.addSession(first.path, "fresh");
      assert.deepEqual(yield* branchChanges(first.path, "fresh"), {
        target: ["release", "worktree"],
        files: [],
      });
      assert.deepEqual(yield* recorded(first.path), {
        folder: repo,
        path: first.path,
        branch: "topic",
        created: {
          branch: "topic",
          baseBranch: "release",
          commit: git(repo, "rev-parse", "release"),
          instance,
        },
      });

      yield* (yield* SidebarView).fresh;
      assert.equal((yield* recorded(first.path))?.created?.baseBranch, "release");
      assert.deepEqual((yield* branchChanges(first.path, "fresh")).target, ["release", "worktree"]);

      const data = yield* registry.get;
      assert.equal(data.workspaces.find((w) => w.path === first.path)?.id, first.workspaceId);
      const old = data.sessions.find((s) => s.sessionId === "before-recreation");
      assert.equal(old?.cwd, first.path);
      assert.deepEqual(yield* branchChanges(first.path, "before-recreation"), {
        target: ["release", "worktree"],
        files: [],
      });
    }),
  );

  git(repo, "worktree", "remove", "--force", first.path);
  git(repo, "worktree", "add", "-q", "-b", "elsewhere", first.path, "main");
  await run(
    Effect.gen(function* () {
      yield* (yield* SidebarView).fresh;
      assert.deepEqual((yield* branchChanges(first.path, "fresh")).target, ["main", "assumed"]);
      assert.deepEqual(yield* recorded(first.path), {
        folder: repo,
        path: first.path,
        branch: "elsewhere",
        created: {
          branch: "topic",
          baseBranch: "release",
          commit: git(repo, "rev-parse", "release"),
          instance,
        },
      });
    }),
  );

  git(repo, "worktree", "remove", "--force", first.path);
  git(repo, "branch", "-D", "topic", "elsewhere");
  git(repo, "worktree", "add", "-q", "-b", "topic", first.path, "main");
  writeFileSync(join(first.path, "replacement-only.txt"), "replacement\n");
  git(first.path, "add", ".");
  commit(first.path, "replacement");
  await run(
    Effect.gen(function* () {
      yield* (yield* SidebarView).fresh;
      assert.deepEqual(yield* branchChanges(first.path, "fresh"), {
        target: ["main", "assumed"],
        files: ["replacement-only.txt"],
      });
      assert.equal((yield* recorded(first.path))?.branch, "topic");
    }),
  );
});

function createdFromRelease(harness: ReturnType<typeof branchChangesHarness>) {
  const { repo, setDefault, run, create } = harness;
  setDefault("release");
  return run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.addFolder(repo);
      const made = yield* create("topic");
      assert.equal(made.baseBranch, "release");
      yield* registry.addSession(made.path, "s");
      return made.path;
    }),
  ).finally(() => setDefault("main"));
}

test("PIN-158: a worktree recreated outside Piano at its path and branch name drops the recorded base even when it shares the recorded history", async (t) => {
  const harness = branchChangesHarness(t);
  const { repo, commit, run, branchChanges } = harness;
  const commitFile = (cwd: string, name: string) => {
    writeFileSync(join(cwd, name), `${name}\n`);
    git(cwd, "add", ".");
    commit(cwd, name);
  };
  const path = await createdFromRelease(harness);
  git(repo, "merge", "-q", "--ff-only", "release");
  commitFile(repo, "main-only.txt");
  git(repo, "worktree", "remove", "--force", path);
  git(repo, "branch", "-D", "topic");
  git(repo, "worktree", "add", "-q", "-b", "topic", path, "main");
  commitFile(path, "replacement-only.txt");
  await run(
    Effect.gen(function* () {
      yield* (yield* SidebarView).fresh;
      assert.deepEqual(yield* branchChanges(path, "s"), {
        target: ["main", "assumed"],
        files: ["replacement-only.txt"],
      });
    }),
  );
});

test("PIN-158: a surviving worktree keeps its recorded base after its branch is rebased onto a rewritten base, and after switching away and back", async (t) => {
  const harness = branchChangesHarness(t);
  const { repo, commit, run, branchChanges } = harness;
  const commitFile = (cwd: string, name: string) => {
    writeFileSync(join(cwd, name), `${name}\n`);
    git(cwd, "add", ".");
    commit(cwd, name);
  };
  const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];
  const path = await createdFromRelease(harness);
  commitFile(path, "feature-only.txt");
  const oldRelease = git(repo, "rev-parse", "release");
  commitFile(repo, "main-only.txt");
  git(repo, ...identity, "rebase", "-q", "main", "release");
  git(repo, "switch", "-q", "main");
  git(path, ...identity, "rebase", "-q", "--onto", "release", oldRelease);
  assert.equal(git(path, "diff", "--name-only", "release...HEAD"), "feature-only.txt");
  const expected = { target: ["release", "worktree"], files: ["feature-only.txt"] };
  await run(
    Effect.gen(function* () {
      yield* (yield* SidebarView).fresh;
      assert.deepEqual(yield* branchChanges(path, "s"), expected);
    }),
  );
  git(path, "switch", "-q", "-c", "detour", "main");
  git(path, "switch", "-q", "topic");
  await run(
    Effect.gen(function* () {
      yield* (yield* SidebarView).fresh;
      assert.deepEqual(yield* branchChanges(path, "s"), expected);
    }),
  );
});
