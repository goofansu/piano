import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { Effect } from "effect";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { GitCommand } from "../server/Subprocess.ts";
import { RevisionStorePath, WorkspaceRevisions, WorkspaceRevisionsLive } from "../server/WorkspaceRevisions.ts";
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
  const workspace = { id: "test-workspace", folder: repo, path: repo };
  const capture = (cli = "git") => Effect.runPromise(Effect.gen(function* () { return yield* (yield* WorkspaceRevisions).capture(workspace); }).pipe(
    Effect.provide(WorkspaceRevisionsLive), Effect.provideService(RevisionStorePath, store), Effect.provideService(GitCommand, cli)));
  return { root, repo, store, workspace, capture };
}
function ready(capture: WorkspaceCapture) {
  assert.equal(capture.result.status, "captured", JSON.stringify(capture.result));
  if (capture.result.status !== "captured") throw new Error("capture failed");
  return capture.result;
}

test("INV-01/07: a folder keeps its workspace identity when closed and reopened", async t => {
  const { root, repo } = fixture(t), path = join(root, "registry.db");
  const run = <A, E>(e: Effect.Effect<A, E, Registry>) => Effect.runPromise(e.pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryDatabasePath, path)));
  const id = (await run(Effect.gen(function* () { const r = yield* Registry; yield* r.addFolder(repo); return yield* r.get; }))).workspaces.find(w => w.path === repo)!.id;
  await run(Effect.gen(function* () { const r = yield* Registry; yield* r.removeFolder(repo); yield* r.addFolder(repo); }));
  assert.equal((await run(Effect.gen(function* () { return yield* (yield* Registry).get; }))).workspaces.find(w => w.path === repo)!.id, id);
});

test("INV-07/08: raw content, stage, untracked, deletion, modes, symlinks and rebased HEAD bind an immutable manifest and diff", async t => {
  const { repo, store, workspace, capture } = fixture(t);
  const first = ready(await capture());
  assert.equal(first.diff, ""); assert.equal(first.stagedDiff, ""); assert.equal(first.unstagedDiff, "");
  assert.equal(ready(await capture()).revision, first.revision);
  writeFileSync(join(repo, "source.txt"), "changed\n");
  const editedReceipt = await capture(), edited = ready(editedReceipt);
  assert.deepEqual(editedReceipt.workspace, workspace); assert.notEqual(edited.revision, first.revision);
  assert.match(edited.unstagedDiff, /\+changed/); assert.equal(edited.stagedDiff, "");
  const candidateFile = edited.manifest.files.find(f => f.path === "source.txt")!;
  assert.equal(readFileSync(join(store, edited.revision, "blobs", candidateFile.sha256), "utf8"), "changed\n");
  const stored = join(store, edited.revision, "blobs", candidateFile.sha256);
  chmodSync(stored, 0o600); writeFileSync(stored, "damaged");
  assert.equal((await capture()).result.status, "error");
  writeFileSync(stored, "changed\n"); chmodSync(stored, 0o400);
  git(repo, "add", "source.txt");
  const staged = ready(await capture()); assert.notEqual(staged.revision, edited.revision);
  assert.match(staged.stagedDiff, /\+changed/); assert.equal(staged.unstagedDiff, ""); assert.equal(staged.diff, edited.diff);
  git(repo, "reset", "-q", "HEAD", "--", "source.txt");
  assert.equal(ready(await capture()).revision, edited.revision);
  writeFileSync(join(repo, "new\nsource.ts"), "untracked source\n");
  const untracked = ready(await capture()); assert.notEqual(untracked.revision, edited.revision);
  assert.ok(untracked.manifest.files.some(f => f.path === "new\nsource.ts")); assert.match(untracked.unstagedDiff, /untracked source/);
  // Git quotes control characters; no-index additions use the destination path on both sides.
  assert.match(untracked.diff, /^diff --git "b\/new\\nsource\.ts" "b\/new\\nsource\.ts"$/m);
  assert.match(untracked.diff, /^\+\+\+ "b\/new\\nsource\.ts"$/m);
  assert.match(untracked.diff, /new file mode 100644[\s\S]*\+untracked source/);
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
