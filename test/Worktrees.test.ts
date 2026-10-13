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
import { DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHostsLive } from "../server/SessionHosts.ts";
import { SidebarView, SidebarViewLive } from "../server/SidebarView.ts";
import {
  checkoutHint,
  createWorktree,
  listWorktrees,
  WorktrunkCommand,
} from "../server/Worktrees.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
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
test("INV-06: discovery reads Git worktrees without Worktrunk and reports failures without healthy fallbacks", async (t) => {
  const { root, repo } = fixture(t);
  git(repo, "worktree", "add", "--quiet", "-b", "feature", join(root, "feature"));
  git(repo, "worktree", "add", "--quiet", "--detach", join(root, "detached"));
  git(repo, "worktree", "add", "--quiet", "-b", "gone", join(root, "gone"));
  rmSync(join(root, "gone"), { recursive: true, force: true });
  // Discovery must not need Worktrunk at all.
  const observe = (path: string) =>
    Effect.runPromise(
      listWorktrees(path).pipe(Effect.provideService(WorktrunkCommand, join(root, "unavailable"))),
    );
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
    ].sort((x, y) => (x.path === repo ? -1 : y.path === repo ? 1 : x.path.localeCompare(y.path))),
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

test("INV-06: creation requires a complete structured new-branch result and never retries prose or bypasses approval", async (t) => {
  const { root, repo } = fixture(t),
    cli = join(root, "wt"),
    config = join(root, "result.json"),
    audit = join(root, "calls.jsonl");
  writeFileSync(
    cli,
    `#!${process.execPath}\nimport {readFileSync,appendFileSync} from 'node:fs';
const a=process.argv.slice(2);appendFileSync(${JSON.stringify(audit)},JSON.stringify(a)+'\\n');
if(a.includes('--version')) console.log('wt v0.80.0');else{const f=JSON.parse(readFileSync(${JSON.stringify(config)},'utf8'));if(f.error){console.error(f.error);process.exit(1);}console.log(f.raw??JSON.stringify(f));}\n`,
    { mode: 0o755 },
  );
  const create = (value: object, hooks = true) => {
    writeFileSync(config, JSON.stringify(value));
    return Effect.runPromise(
      createWorktree(repo, "feature", { hooks }).pipe(
        Effect.result,
        Effect.provideService(WorktrunkCommand, cli),
      ),
    );
  };
  const good = {
    action: "created",
    branch: "feature",
    path: join(root, "custom-path"),
    created_branch: true,
    base_branch: "main",
  };
  const ok = await create(good, false);
  assert.equal(ok._tag, "Success");
  if (ok._tag === "Success")
    assert.deepEqual(ok.success, {
      branch: "feature",
      path: good.path,
      baseBranch: "main",
      hooks: "skipped",
    });
  for (const bad of [
    { ...good, action: "switched" },
    { ...good, path: "relative" },
    { ...good, base_branch: null },
    { raw: `noise\n${JSON.stringify(good)}` },
    { error: "Branch feature already exists" },
  ]) {
    const result = await create(bad);
    assert.equal(result._tag, "Failure");
    // Worktrunk ran, so a checkout may exist; the error must say so.
    if (result._tag === "Failure")
      assert.match(result.failure.detail, /Creation was not confirmed/);
  }
  const calls = readFileSync(audit, "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
    .filter((a) => a.includes("switch"));
  assert.equal(calls.length, 6);
  assert.ok(
    calls.every((a) => !a.includes("-y") && !a.includes("--yes") && a.includes("--create")),
  );
  assert.ok(calls[0].includes("--no-hooks"));
  assert.ok(!calls[1].includes("--no-hooks"));
});

test("INV-06: Worktrunk 0.80.0 and later create worktrees; older or unrecognized versions do not", async (t) => {
  const { root, repo } = fixture(t),
    cli = join(root, "wt"),
    version = join(root, "version");
  const created = JSON.stringify({
    action: "created",
    branch: "feature",
    path: join(root, "feature"),
    created_branch: true,
    base_branch: "main",
  });
  writeFileSync(
    cli,
    `#!${process.execPath}\nimport {readFileSync} from 'node:fs';
console.log(process.argv.includes('--version')?readFileSync(${JSON.stringify(version)},'utf8'):${JSON.stringify(created)});\n`,
    { mode: 0o755 },
  );
  const create = (reported: string) => {
    writeFileSync(version, reported);
    return Effect.runPromise(
      createWorktree(repo, "feature").pipe(
        Effect.result,
        Effect.provideService(WorktrunkCommand, cli),
      ),
    );
  };
  for (const reported of ["wt v0.80.0", "wt v0.81.0", "wt v0.80.1", "wt v1.0.0"])
    assert.equal((await create(reported))._tag, "Success", reported);
  for (const reported of ["wt v0.79.9", "wt v0.9.0", "worktrunk 0.81.0", ""]) {
    const result = await create(reported);
    assert.equal(result._tag, "Failure", reported);
    if (result._tag === "Failure") {
      assert.match(result.failure.detail, /0\.80\.0 or later/);
      // The version check runs before Worktrunk creates anything.
      assert.doesNotMatch(result.failure.detail, /Creation was not confirmed/);
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
  writeFileSync(join(repo, ".config", "wt.toml"), 'pre-start = "echo ran > hook-ran; exit 3"\n');
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
  assert.equal(existsSync(join(partial, "hook-ran")), true);
  observed = await run(listWorktrees(repo));
  assert.ok(observed.status === "ready" && observed.worktrees.some((w) => w.path === partial));

  // Through the actual view caller: registry names never become Git facts and
  // external deletion/failure must not hide registered session references.
  const layer = SidebarViewLive().pipe(
    Layer.provide(DirectoryFactsLive),
    Layer.provideMerge(SessionHostsLive({ idleMs: 0 })),
    Layer.provide(PiSessionsLive),
    Layer.provideMerge(RegistryLive),
    Layer.provide(NodeServices.layer),
  );
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
