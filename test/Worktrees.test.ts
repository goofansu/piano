import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHostsLive } from "../server/SessionHosts.ts";
import { buildFolders } from "../server/Views.ts";
import { createWorktree, listWorktrees, WorktrunkCommand } from "../server/Worktrees.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
function fixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-worktrees-")), repo = join(root, "repo");
  mkdirSync(repo); git(repo, "init", "--quiet", "-b", "main");
  git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "baseline");
  t.after(() => {
    for (const line of git(repo, "worktree", "list", "--porcelain").split("\n")) {
      if (line.startsWith("worktree ") && line.slice(9) !== repo) git(repo, "worktree", "remove", "--force", line.slice(9));
    }
    for (const branch of git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n")) {
      if (branch && branch !== "main") git(repo, "branch", "-D", branch);
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, repo };
}
test("INV-06: discovery reads Git worktrees without Worktrunk and reports failures without healthy fallbacks", async t => {
  const { root, repo } = fixture(t);
  git(repo, "worktree", "add", "--quiet", "-b", "feature", join(root, "feature"));
  git(repo, "worktree", "add", "--quiet", "--detach", join(root, "detached"));
  git(repo, "worktree", "add", "--quiet", "-b", "gone", join(root, "gone"));
  rmSync(join(root, "gone"), { recursive: true, force: true });
  // Discovery must not need Worktrunk at all.
  const observe = (path: string) => Effect.runPromise(listWorktrees(path).pipe(Effect.provideService(WorktrunkCommand, join(root, "unavailable"))));
  const result = await observe(repo);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.currentPath, repo);
  assert.deepEqual(result.worktrees, [
    { path: repo, branch: "main", detached: false, prunable: false },
    { path: join(root, "detached"), branch: null, detached: true, prunable: false },
    { path: join(root, "feature"), branch: "feature", detached: false, prunable: false },
    { path: join(root, "gone"), branch: "gone", detached: false, prunable: true },
  ].sort((x, y) => x.path === repo ? -1 : y.path === repo ? 1 : x.path.localeCompare(y.path)));
  mkdirSync(join(repo, "subdirectory"));
  const subdir = await observe(join(repo, "subdirectory"));
  assert.ok(subdir.status === "ready" && subdir.currentPath === repo);
  const linked = await observe(join(root, "feature"));
  assert.ok(linked.status === "ready" && linked.currentPath === join(root, "feature"));
  const nonGit = join(root, "notes"); mkdirSync(nonGit);
  assert.equal((await observe(nonGit)).status, "non-git");
  writeFileSync(join(nonGit, ".git"), "gitdir: /not/a/repository\n");
  const broken = await observe(nonGit);
  assert.equal(broken.status, "error"); assert.equal("worktrees" in broken, false);
});

test("INV-06: creation requires a complete structured new-branch result and never retries prose or bypasses approval", async t => {
  const { root, repo } = fixture(t), cli = join(root, "wt"), config = join(root, "result.json"), audit = join(root, "calls.jsonl");
  writeFileSync(cli, `#!${process.execPath}\nimport {readFileSync,appendFileSync} from 'node:fs';
const a=process.argv.slice(2);appendFileSync(${JSON.stringify(audit)},JSON.stringify(a)+'\\n');
if(a.includes('--version')) console.log('wt v0.80.0');else{const f=JSON.parse(readFileSync(${JSON.stringify(config)},'utf8'));if(f.error){console.error(f.error);process.exit(1);}console.log(f.raw??JSON.stringify(f));}\n`, { mode: 0o755 });
  const create = (value: object, hooks = true) => { writeFileSync(config, JSON.stringify(value)); return Effect.runPromise(createWorktree(repo, "feature", { hooks }).pipe(Effect.result, Effect.provideService(WorktrunkCommand, cli))); };
  const good = { action: "created", branch: "feature", path: join(root, "custom-path"), created_branch: true, base_branch: "main" };
  const ok = await create(good, false); assert.equal(ok._tag, "Success");
  if (ok._tag === "Success") assert.deepEqual(ok.success, { branch: "feature", path: good.path, baseBranch: "main", hooks: "skipped" });
  for (const bad of [{ ...good, action: "switched" }, { ...good, path: "relative" }, { ...good, base_branch: null },
    { raw: `noise\n${JSON.stringify(good)}` }, { error: "Branch feature already exists" }]) assert.equal((await create(bad))._tag, "Failure");
  const calls = readFileSync(audit, "utf8").trim().split("\n").map(s => JSON.parse(s)).filter(a => a.includes("switch"));
  assert.equal(calls.length, 6); assert.ok(calls.every(a => !a.includes("-y") && !a.includes("--yes") && a.includes("--create")));
  assert.ok(calls[0].includes("--no-hooks")); assert.ok(!calls[1].includes("--no-hooks"));
});

test("INV-06: real Worktrunk 0.80.0 custom paths, external edits/detachment, unapproved and failed hooks", async t => {
  const { root, repo } = fixture(t), cli = join(root, "wt"), config = join(root, "config"), home = join(root, "home");
  mkdirSync(join(config, "worktrunk"), { recursive: true }); mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), WORKTRUNK_CONFIG_PATH: join(config, "worktrunk", "config.toml") };
  writeFileSync(env.WORKTRUNK_CONFIG_PATH, 'worktree-path = "../custom/{{ branch | sanitize }}"\n[list]\njson-schema = 1\n');
  const wtPath = execFileSync("which", ["wt"], { encoding: "utf8" }).trim();
  writeFileSync(cli, `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';const r=spawnSync(${JSON.stringify(wtPath)},process.argv.slice(2),{stdio:'inherit',env:{...process.env,...${JSON.stringify({ HOME: home, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: env.XDG_CACHE_HOME, XDG_STATE_HOME: env.XDG_STATE_HOME, WORKTRUNK_CONFIG_PATH: env.WORKTRUNK_CONFIG_PATH })}}});process.exit(r.status??1);\n`, { mode: 0o755 });
  const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e.pipe(Effect.provideService(WorktrunkCommand, cli)));
  assert.equal(execFileSync(wtPath, ["--version"], { encoding: "utf8", env }).trim(), "wt v0.80.0");
  const created = await run(createWorktree(repo, "feature"));
  assert.equal(created.path, join(root, "custom", "feature")); assert.equal(created.baseBranch, "main");
  writeFileSync(join(created.path, "new-source.ts"), "export const x = 1;\n");
  git(created.path, "checkout", "--quiet", "--detach");
  let observed = await run(listWorktrees(repo)); assert.equal(observed.status, "ready");
  if (observed.status === "ready") {
    const w = observed.worktrees.find(w => w.path === created.path)!;
    assert.equal(w.branch, null); assert.equal(w.detached, true);
  }
  mkdirSync(join(repo, ".config")); writeFileSync(join(repo, ".config", "wt.toml"), 'pre-start = "echo ran > hook-ran; exit 3"\n');
  git(repo, "add", ".config"); git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "hook");
  const rejected = await run(createWorktree(repo, "unapproved", { hooks: true }).pipe(Effect.flip));
  assert.match(rejected.detail, /approval/i); assert.equal(existsSync(join(root, "custom", "unapproved")), false);
  assert.equal(spawnSync("git", ["-C", repo, "show-ref", "--verify", "--quiet", "refs/heads/unapproved"]).status, 1);
  // Explicit fixture approval, not an adapter behavior. A foreground hook fails after creation.
  execFileSync(wtPath, ["-C", repo, "config", "approvals", "add", "--yes"], { env, stdio: "pipe" });
  const failed = await run(createWorktree(repo, "partial", { hooks: true }).pipe(Effect.flip));
  assert.match(failed.detail, /Creation was not confirmed/);
  const partial = join(root, "custom", "partial");
  assert.equal(existsSync(join(partial, "hook-ran")), true);
  observed = await run(listWorktrees(repo));
  assert.ok(observed.status === "ready" && observed.worktrees.some(w => w.path === partial));

  // Through the actual view caller: registry names never become Git facts and
  // external deletion/failure must not hide registered session references.
  const layer = SessionHostsLive({ idleMs: 0 }).pipe(Layer.provide(PiSessionsLive), Layer.provideMerge(RegistryLive), Layer.provide(NodeServices.layer));
  await Effect.runPromise(Effect.gen(function* () {
    const registry = yield* Registry;
    yield* registry.addFolder(repo);
    yield* registry.addWorktree({ folder: repo, path: created.path, branch: "old-registry-branch" });
    yield* registry.addSession(created.path, "saved-history");
    let view = (yield* buildFolders)[0];
    assert.equal(view.worktrees.length, 2); // the unselected partial checkout is discovery only
    assert.equal(view.sessions.length, 1);
    assert.equal(view.worktrees[1].branch, null); assert.equal(view.worktrees[1].facts?.detached, true);
    git(repo, "worktree", "remove", "--force", created.path);
    view = (yield* buildFolders)[0];
    assert.equal(view.worktrees[1].status, "missing"); assert.equal(view.sessions[0].sessionId, "saved-history");
    // Unreadable repository metadata: Git fails, and nothing pretends the project is healthy.
    chmodSync(join(repo, ".git"), 0o000);
    try { view = (yield* buildFolders)[0]; } finally { chmodSync(join(repo, ".git"), 0o755); }
    assert.equal(view.discovery.status, "error"); assert.equal(view.worktrees[0].status, "unknown");
    assert.equal(view.worktrees[0].branch, null); assert.equal(view.sessions.length, 1);
    const data = yield* registry.get;
    assert.equal(data.worktrees[0].branch, "old-registry-branch"); // no silent migration
    assert.equal(data.worktrees.length, 1); assert.equal(data.sessions.length, 1);
  }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(RegistryDatabasePath, join(root, "registry.db")), Effect.provideService(WorktrunkCommand, cli)));
});
