import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Effect, Layer } from "effect";
import { NodeServices } from "@effect/platform-node";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryLive, RegistryPath } from "../server/Registry.ts";
import { SessionHostsLive } from "../server/SessionHosts.ts";
import { buildProjects } from "../server/Views.ts";
import { createWorktree, listWorktrees, WorktrunkCommand } from "../server/Worktrees.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-worktrees-")), repo = join(root, "repo");
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
const changes = { staged: false, modified: false, untracked: false, renamed: false, deleted: false, conflicted: false };
const envelope = (path: string) => ({ schema: 2, repo: { default_branch: "main" }, collected: { ci: false, summary: false }, items: [
  { branch: "main", head: { sha: "a".repeat(40) }, worktree: { path, main: true, current: true, detached: false, changes } },
] });

test("INV-06: discovery validates schema/output and preserves null/absent/dirty/detached facts without healthy fallbacks", async t => {
  const { root, repo } = fixture(t), config = join(root, "result.json"), cli = join(root, "wt"), audit = join(root, "calls.jsonl");
  writeFileSync(cli, `#!${process.execPath}\nimport {readFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2), f=JSON.parse(readFileSync(${JSON.stringify(config)},'utf8'));
appendFileSync(${JSON.stringify(audit)},JSON.stringify(args)+'\\n');
if(args.includes('--version')) console.log(f.version??'wt v0.80.0');
else if(f.error){console.error(f.error);process.exit(1);}
else console.log(f.raw??JSON.stringify(f.output));\n`, { mode: 0o755 });
  const observe = (f: object) => { writeFileSync(config, JSON.stringify(f)); return Effect.runPromise(listWorktrees(repo).pipe(Effect.provideService(WorktrunkCommand, cli))); };
  const base = envelope(repo);
  const result = await observe({ output: { ...base, items: [base.items[0],
    { branch: null, head: null, worktree: { path: join(root, "detached"), main: false, current: false, detached: true, changes: null, operation: null, locked: null } },
    { branch: "dirty", head: { sha: "b".repeat(40) }, worktree: { path: join(root, "dirty"), main: false, current: false, detached: false, changes: { ...changes, modified: true, conflicted: null }, operation: "rebase", prunable: { reason: "gone" } } },
    { branch: "branch-only", head: null },
  ] } });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.worktrees.length, 3);
  assert.equal(result.currentPath, repo);
  assert.deepEqual(result.worktrees[0].changes, changes);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(result.worktrees[0])), "operation"), false);
  assert.equal(result.worktrees[1].branch, null); assert.equal(result.worktrees[1].head, null);
  assert.equal(result.worktrees[1].changes, null); assert.equal(result.worktrees[1].operation, null); assert.equal(result.worktrees[1].locked, null);
  assert.equal(result.worktrees[2].changes?.conflicted, null); assert.equal(result.worktrees[2].operation, "rebase");
  assert.deepEqual(result.worktrees[2].prunable, { reason: "gone" });
  const calls = readFileSync(audit, "utf8").trim().split("\n").map(s => JSON.parse(s));
  assert.ok(calls[1].includes("--no-progressive")); assert.ok(calls[1].includes("list.full=false"));
  for (const f of [{ output: { ...base, schema: 1 } }, { output: [] }, { raw: "not json" }, { output: { ...base, items: [] } },
    { output: { ...base, items: [{ ...base.items[0], worktree: { ...base.items[0].worktree, changes: { modified: false } } }] } },
    { version: "wt v0.81.0", output: base }, { error: "backend failed" }]) {
    const failed = await observe(f); assert.equal(failed.status, "error"); assert.equal("worktrees" in failed, false);
  }
  assert.equal((await Effect.runPromise(listWorktrees(repo).pipe(Effect.provideService(WorktrunkCommand, join(root, "unavailable"))))).status, "error");
  const nonGit = join(root, "notes"); mkdirSync(nonGit);
  assert.equal((await Effect.runPromise(listWorktrees(nonGit).pipe(Effect.provideService(WorktrunkCommand, cli)))).status, "non-git");
  writeFileSync(join(nonGit, ".git"), "gitdir: /not/a/repository\n");
  assert.equal((await Effect.runPromise(listWorktrees(nonGit).pipe(Effect.provideService(WorktrunkCommand, cli)))).status, "error");
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
  mkdirSync(join(repo, "subdirectory"));
  const subdir = await run(listWorktrees(join(repo, "subdirectory")));
  assert.ok(subdir.status === "ready" && subdir.currentPath === repo);
  const created = await run(createWorktree(repo, "feature"));
  assert.equal(created.path, join(root, "custom", "feature")); assert.equal(created.baseBranch, "main");
  writeFileSync(join(created.path, "new-source.ts"), "export const x = 1;\n");
  git(created.path, "checkout", "--quiet", "--detach");
  let observed = await run(listWorktrees(repo)); assert.equal(observed.status, "ready");
  if (observed.status === "ready") {
    const w = observed.worktrees.find(w => w.path === created.path)!;
    assert.equal(w.branch, null); assert.equal(w.detached, true); assert.equal(w.changes?.untracked, true);
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
    yield* registry.addProject(repo);
    yield* registry.addWorktree({ project: repo, path: created.path, branch: "old-registry-branch" });
    yield* registry.addSession(created.path, "saved-history");
    let view = (yield* buildProjects)[0];
    assert.equal(view.worktrees.length, 2); // the unselected partial checkout is discovery only
    assert.equal(view.sessions.length, 1);
    assert.equal(view.worktrees[1].branch, null); assert.equal(view.worktrees[1].facts?.detached, true);
    git(repo, "worktree", "remove", "--force", created.path);
    view = (yield* buildProjects)[0];
    assert.equal(view.worktrees[1].status, "missing"); assert.equal(view.sessions[0].sessionId, "saved-history");
    view = (yield* buildProjects.pipe(Effect.provideService(WorktrunkCommand, join(root, "missing-wt"))))[0];
    assert.equal(view.discovery.status, "error"); assert.equal(view.worktrees[0].status, "unknown");
    assert.equal(view.worktrees[0].branch, null); assert.equal(view.sessions.length, 1);
    const data = yield* registry.get;
    assert.equal(data.worktrees[0].branch, "old-registry-branch"); // no silent migration
    assert.equal(data.worktrees.length, 1); assert.equal(data.sessions.length, 1);
  }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(RegistryPath, join(root, "registry.json")), Effect.provideService(WorktrunkCommand, cli)));
});
