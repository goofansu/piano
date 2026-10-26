import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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
import { PianoCoreLive } from "../server/PianoServices.ts";
import { Registry, RegistryDatabasePath } from "../server/Registry.ts";
import { SidebarView } from "../server/SidebarView.ts";
import { createWorktree, listWorktrees, WorktrunkCommand } from "../server/Worktrees.ts";

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
test("INV-06/INV-07: real Worktrunk creation ignores inherited Git redirection", async (t) => {
  const { root, repo } = fixture(t);
  const { repo: other } = fixture(t);
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
  const config = join(root, "wt.toml");
  writeFileSync(config, 'worktree-path = "../custom/{{ branch | sanitize }}"\n');
  const inherited = {
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
    WORKTRUNK_CONFIG_PATH: config,
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
    assert.equal(readFileSync(join(created.path, "identity"), "utf8"), "requested");
    assert.equal(created.path, join(root, "custom", "requested-branch"));
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

test("INV-06: real Worktrunk custom paths, external edits/detachment, unapproved and failed hooks", async (t) => {
  const { root, repo } = fixture(t),
    cli = join(root, "wt"),
    config = join(root, "config"),
    home = join(root, "home");
  mkdirSync(join(config, "worktrunk"), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(home, ".gitconfig"), "[piano]\nmarker = user-config-loaded\n");
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    WORKTRUNK_CONFIG_PATH: join(config, "worktrunk", "config.toml"),
  };
  writeFileSync(
    env.WORKTRUNK_CONFIG_PATH,
    'worktree-path = "../custom/{{ branch | sanitize }}"\n[list]\njson-schema = 1\n',
  );
  const wtPath = execFileSync("which", ["wt"], { encoding: "utf8" }).trim();
  writeFileSync(
    cli,
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';const r=spawnSync(${JSON.stringify(wtPath)},process.argv.slice(2),{stdio:'inherit',env:{...process.env,...${JSON.stringify({ HOME: home, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: env.XDG_CACHE_HOME, XDG_STATE_HOME: env.XDG_STATE_HOME, WORKTRUNK_CONFIG_PATH: env.WORKTRUNK_CONFIG_PATH })}}});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );
  const run = <A, E>(e: Effect.Effect<A, E>) =>
    Effect.runPromise(e.pipe(Effect.provideService(WorktrunkCommand, cli)));
  assert.match(
    execFileSync(wtPath, ["--version"], { encoding: "utf8", env }).trim(),
    /^wt v\d+\.\d+\.\d+/,
  );
  const created = await run(createWorktree(repo, "feature"));
  assert.equal(created.path, join(root, "custom", "feature"));
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
  mkdirSync(join(repo, ".config"));
  writeFileSync(
    join(repo, ".config", "wt.toml"),
    'pre-start = "git config piano.marker > hook-ran; exit 3"\n',
  );
  git(repo, "add", ".config");
  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "hook",
  );
  const skipped = await run(createWorktree(repo, "hooks-off"));
  assert.equal(skipped.hooks, "skipped");
  assert.equal(existsSync(join(skipped.path, "hook-ran")), false);
  const rejected = await run(createWorktree(repo, "unapproved", { hooks: true }).pipe(Effect.flip));
  assert.match(rejected.detail, /approval/i);
  assert.equal(existsSync(join(root, "custom", "unapproved")), false);
  assert.equal(
    spawnSync("git", ["-C", repo, "show-ref", "--verify", "--quiet", "refs/heads/unapproved"])
      .status,
    1,
  );
  // Explicit fixture approval, not an adapter behavior. A foreground hook fails after creation.
  execFileSync(wtPath, ["-C", repo, "config", "approvals", "add", "--yes"], { env, stdio: "pipe" });
  const failed = await run(createWorktree(repo, "partial", { hooks: true }).pipe(Effect.flip));
  assert.match(failed.detail, /Creation was not confirmed/);
  const partial = join(root, "custom", "partial");
  assert.equal(readFileSync(join(partial, "hook-ran"), "utf8"), "user-config-loaded\n");
  observed = await run(listWorktrees(repo));
  assert.ok(observed.status === "ready" && observed.worktrees.some((w) => w.path === partial));

  // Through the actual view caller: registry names never become Git facts and
  // external deletion/failure must not hide registered session references.
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
      assert.equal(view.worktrees.length, 2); // the unselected partial checkout is discovery only
      assert.equal(view.worktrees[1].branch, null);
      assert.equal(view.worktrees[1].facts?.detached, true);
      let [saved] = yield* references;
      // INV-07: the reference carries its workspace; its branch is Git's (detached: unknown), never the registry's cached name.
      assert.equal(saved?.workspaceId, view.worktrees[1].workspace.id);
      assert.equal(saved?.branch, null);
      git(repo, "worktree", "remove", "--force", created.path);
      view = (yield* buildFolders)[0];
      assert.equal(view.worktrees[1].status, "missing");
      [saved] = yield* references;
      assert.equal(saved?.sessionId, "saved-history");
      // Unreadable repository metadata: Git fails, and nothing pretends the project is healthy.
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
      assert.equal(data.worktrees[0].branch, "old-registry-branch"); // no silent migration
      assert.equal(data.worktrees.length, 1);
      assert.equal(data.sessions.length, 1);
    }).pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(RegistryDatabasePath, join(root, "registry.db")),
      Effect.provideService(WorktrunkCommand, cli),
    ),
  );
});
