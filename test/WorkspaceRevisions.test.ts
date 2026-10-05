import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Effect } from "effect";
import { Registry, RegistryLive, RegistryPath } from "../server/Registry.ts";
import { RevisionGitCommand, RevisionStorePath, WorkspaceRevisions, WorkspaceRevisionsLive } from "../server/WorkspaceRevisions.ts";
import type { WorkspaceCapture } from "../shared/wire.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], {
  encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: ["ignore", "pipe", "pipe"],
}).trim();
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-revisions-")), repo = join(root, "repo"), store = join(root, "candidates");
  mkdirSync(repo); git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "source.txt"), "base\n"); writeFileSync(join(repo, ".gitignore"), "ignored/\n");
  git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = { id: "test-workspace", project: repo, path: repo };
  const capture = (cli = "git") => Effect.runPromise(Effect.gen(function* () { return yield* (yield* WorkspaceRevisions).capture(workspace); }).pipe(
    Effect.provide(WorkspaceRevisionsLive), Effect.provideService(RevisionStorePath, store), Effect.provideService(RevisionGitCommand, cli)));
  const materialize = (revision: string, directory: string) => Effect.runPromise(Effect.gen(function* () {
    yield* (yield* WorkspaceRevisions).materialize(revision, directory);
  }).pipe(Effect.provide(WorkspaceRevisionsLive), Effect.provideService(RevisionStorePath, store)));
  return { root, repo, store, workspace, capture, materialize };
}
function ready(capture: WorkspaceCapture) {
  assert.equal(capture.result.status, "captured", JSON.stringify(capture.result));
  if (capture.result.status !== "captured") throw new Error("capture failed");
  return capture.result;
}

test("INV-01/07: migration backs up exact bytes, preserves references and workspace identity; malformed data never resets", async t => {
  const { root, repo } = fixture(t), path = join(root, "registry.json"), worktree = join(root, "selected"), hidden = join(root, "hidden");
  const original = JSON.stringify({ projects: [repo], worktrees: [{ project: repo, path: worktree, branch: "old-name" }], threads: [
    { cwd: worktree, sessionId: "saved", createdAt: "then", updatedAt: "now" },
    { cwd: hidden, sessionId: "hidden", archived: true, createdAt: "then", updatedAt: "now" },
  ] });
  writeFileSync(path, original);
  const run = <A, E>(e: Effect.Effect<A, E, Registry>) => Effect.runPromise(e.pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryPath, path)));
  const migrated = await run(Effect.gen(function* () { return yield* (yield* Registry).get; }));
  assert.equal(migrated.version, 1); assert.equal(migrated.workspaces.length, 3);
  assert.equal(migrated.sessions[0].cwd, worktree); assert.equal(migrated.sessions[0].archived, false);
  assert.equal(migrated.sessions[1].archived, true); assert.equal(migrated.worktrees[0].branch, "old-name");
  const backup = readdirSync(root).find(p => p.endsWith(".bak"))!;
  assert.equal(readFileSync(join(root, backup), "utf8"), original);
  const id = migrated.workspaces.find(w => w.path === repo)!.id;
  await run(Effect.gen(function* () { const r = yield* Registry; yield* r.removeProject(repo); yield* r.addProject(repo); }));
  assert.equal((await run(Effect.gen(function* () { return yield* (yield* Registry).get; }))).workspaces.find(w => w.path === repo)!.id, id);
  for (const damaged of ["{broken", JSON.stringify({ projects: [123], worktrees: [], sessions: [] }), JSON.stringify({ ...migrated, version: 2 }), JSON.stringify({ ...migrated, workspaces: [] })]) {
    writeFileSync(path, damaged);
    await assert.rejects(run(Effect.gen(function* () { yield* (yield* Registry).addProject(repo); })), /has not been reset/);
    assert.equal(readFileSync(path, "utf8"), damaged);
  }
  unlinkSync(path); symlinkSync(join(root, "missing-config"), path);
  await assert.rejects(run(Effect.gen(function* () { return yield* (yield* Registry).get; })), /Registry symlinks/);
  assert.equal(existsSync(join(root, "missing-config")), false);
  unlinkSync(path); writeFileSync(path, JSON.stringify(migrated));
  await run(Effect.gen(function* () {
    const r = yield* Registry, before = yield* r.get;
    // Force an atomic rename failure; memory must retain the previous state too.
    unlinkSync(path); mkdirSync(path);
    const error = yield* r.addSession(repo, "not-persisted").pipe(Effect.flip);
    assert.match(error.detail, /has not been reset/); assert.deepEqual(yield* r.get, before);
  }));
  assert.equal(readdirSync(root).filter(p => p.endsWith(".bak")).length, 1);
});

test("INV-07/08: raw content, stage, untracked, deletion, modes, symlinks and rebased HEAD bind an immutable manifest and diff", async t => {
  const { root, repo, store, workspace, capture, materialize } = fixture(t);
  const first = ready(await capture());
  assert.equal(first.stagedDiff, ""); assert.equal(first.unstagedDiff, "");
  assert.equal(ready(await capture()).revision, first.revision);
  writeFileSync(join(repo, "source.txt"), "changed\n");
  const editedReceipt = await capture(), edited = ready(editedReceipt);
  assert.deepEqual(editedReceipt.workspace, workspace); assert.notEqual(edited.revision, first.revision);
  assert.match(edited.unstagedDiff, /\+changed/); assert.equal(edited.stagedDiff, "");
  const candidateFile = edited.manifest.files.find(f => f.path === "source.txt")!;
  assert.equal(readFileSync(join(store, edited.revision, "blobs", candidateFile.sha256), "utf8"), "changed\n");
  const stored = join(store, edited.revision, "blobs", candidateFile.sha256);
  const copy = join(root, "execution"); await materialize(edited.revision, copy);
  assert.equal(readFileSync(join(copy, "source.txt"), "utf8"), "changed\n");
  chmodSync(join(copy, "source.txt"), 0o600); writeFileSync(join(copy, "source.txt"), "private copy");
  assert.equal(readFileSync(stored, "utf8"), "changed\n", "execution never shares candidate blobs");
  chmodSync(stored, 0o600); writeFileSync(stored, "damaged");
  await assert.rejects(materialize(edited.revision, join(root, "damaged-execution")), /damaged/);
  assert.equal((await capture()).result.status, "error");
  writeFileSync(stored, "changed\n"); chmodSync(stored, 0o400);
  git(repo, "add", "source.txt");
  const staged = ready(await capture()); assert.notEqual(staged.revision, edited.revision);
  assert.match(staged.stagedDiff, /\+changed/); assert.equal(staged.unstagedDiff, "");
  git(repo, "reset", "-q", "HEAD", "--", "source.txt");
  assert.equal(ready(await capture()).revision, edited.revision);
  writeFileSync(join(repo, "new\nsource.ts"), "untracked source\n");
  const untracked = ready(await capture()); assert.notEqual(untracked.revision, edited.revision);
  assert.ok(untracked.manifest.files.some(f => f.path === "new\nsource.ts")); assert.match(untracked.unstagedDiff, /untracked source/);
  unlinkSync(join(repo, "source.txt"));
  const deleted = ready(await capture()); assert.notEqual(deleted.revision, untracked.revision); assert.match(deleted.unstagedDiff, /deleted file mode/);
  assert.equal(deleted.manifest.files.some(f => f.path === "source.txt"), false);
  chmodSync(join(repo, "new\nsource.ts"), 0o755);
  const executable = ready(await capture()); assert.notEqual(executable.revision, deleted.revision);
  assert.equal(executable.manifest.files.find(f => f.path === "new\nsource.ts")?.mode, "100755");
  symlinkSync("new\nsource.ts", join(repo, "link"));
  const link = ready(await capture()); assert.notEqual(link.revision, executable.revision); assert.match(link.unstagedDiff, /120000/);
  assert.equal(link.manifest.files.find(f => f.path === "link")?.mode, "120000");
  unlinkSync(join(repo, "link")); symlinkSync("/outside/not-captured", join(repo, "link"));
  const external = ready(await capture()); assert.notEqual(external.revision, link.revision); assert.ok(external.limitations.some(s => s.includes("Symlinks")));
  mkdirSync(join(repo, "ignored")); writeFileSync(join(repo, "ignored", "dependency"), "v1");
  const ignored = ready(await capture()); assert.ok(ignored.manifest.scope.ignored.includes("ignored/"));
  writeFileSync(join(repo, "ignored", "dependency"), "v2"); assert.equal(ready(await capture()).revision, ignored.revision); // explicit exclusion, never verified input
  assert.equal(readFileSync(join(store, edited.revision, "blobs", candidateFile.sha256), "utf8"), "changed\n");
  // Actual rebase with identical worktree bytes still invalidates conservatively by HEAD.
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "feature"); git(repo, "branch", "feature");
  const beforeRebase = ready(await capture());
  git(repo, "switch", "--detach", "HEAD~1"); git(repo, "commit", "--allow-empty", "-qm", "new base"); const target = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "feature"); git(repo, "rebase", "--onto", target, "HEAD~1");
  const rebased = ready(await capture()); assert.notEqual(rebased.revision, beforeRebase.revision);
  assert.deepEqual(rebased.manifest.files, beforeRebase.manifest.files);
});

test("INV-08: transient capture mutation is inconclusive, not a stable before/after fingerprint", async t => {
  const { root, repo, store, capture } = fixture(t), cli = join(root, "git-observer");
  writeFileSync(cli, `#!${process.execPath}\nimport{spawnSync}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';
const args=process.argv.slice(2);if(args.includes('diff')){const p=${JSON.stringify(join(repo, "source.txt"))};const original=readFileSync(p);writeFileSync(p,'transient');writeFileSync(p,original);}
const r=spawnSync('git',args,{stdio:'inherit'});process.exit(r.status??1);\n`, { mode: 0o755 });
  const result = await capture(cli); assert.equal(result.result.status, "inconclusive");
  assert.equal(readFileSync(join(repo, "source.txt"), "utf8"), "base\n");
  assert.deepEqual(readdirSync(store), []); // no published candidate, no abandoned temporary
  ready(await capture());
});

test("INV-08: conflicts, submodules, intent-to-add and missing checkout refuse exactness rather than omit inputs", async t => {
  const { repo, capture } = fixture(t);
  writeFileSync(join(repo, "intent"), "not staged"); git(repo, "add", "-N", "intent");
  assert.equal((await capture()).result.status, "unsupported"); git(repo, "reset", "-q"); unlinkSync(join(repo, "intent"));
  git(repo, "update-index", "--add", "--cacheinfo", `160000,${git(repo, "rev-parse", "HEAD")},submodule`);
  assert.equal((await capture()).result.status, "unsupported"); git(repo, "reset", "-q");
  git(repo, "switch", "-c", "other"); writeFileSync(join(repo, "source.txt"), "theirs\n"); git(repo, "commit", "-qam", "theirs");
  git(repo, "switch", "main"); writeFileSync(join(repo, "source.txt"), "ours\n"); git(repo, "commit", "-qam", "ours");
  assert.throws(() => git(repo, "merge", "other")); assert.equal((await capture()).result.status, "unsupported");
  git(repo, "merge", "--abort"); rmSync(join(repo, ".git"), { recursive: true, force: true });
  const failure = (await capture()).result; assert.equal(failure.status, "error"); assert.equal("manifest" in failure, false);
  assert.equal(existsSync(join(repo, "source.txt")), true);
});
