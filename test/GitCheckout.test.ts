import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { observeGit } from "../server/GitCheckout.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    },
  ).trim();
const observe = (path: string, options: Parameters<typeof observeGit>[1] = {}) =>
  Effect.runPromise(observeGit(path, options));

test("INV-06: the Git observation tells non-Git paths from broken metadata and never guesses a checkout", async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-git-observation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "subdirectory"), { recursive: true });
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "baseline");

  // Discovery's observation reads no branch.
  assert.deepEqual(await observe(join(repo, "subdirectory")), {
    status: "checkout",
    toplevel: repo,
  });
  assert.deepEqual(await observe(repo, { branch: true }), {
    status: "checkout",
    toplevel: repo,
    branch: "main",
  });
  // A detached HEAD has no branch.
  git(repo, "checkout", "--quiet", "--detach");
  assert.deepEqual(await observe(repo, { branch: true }), {
    status: "checkout",
    toplevel: repo,
    branch: null,
  });
  git(repo, "checkout", "--quiet", "main");
  assert.deepEqual(await observe(repo, { remote: true }), {
    status: "checkout",
    toplevel: repo,
    branch: "main",
    remote: null,
  });
  git(repo, "remote", "add", "origin", "git@github.com:example/repo.git");
  const tracked = await observe(repo, { remote: true });
  assert.ok(tracked.status === "checkout" && tracked.remote === "git@github.com:example/repo.git");

  const notes = join(root, "notes");
  mkdirSync(notes);
  assert.deepEqual(await observe(notes), { status: "non-git" });
  // Git also says "not a git repository" here; the `.git` entry makes it broken, not non-Git.
  writeFileSync(join(notes, ".git"), "gitdir: /not/a/repository\n");
  const brokenFile = await observe(notes);
  assert.equal(brokenFile.status, "broken");
  assert.match(brokenFile.status === "broken" ? brokenFile.detail : "", /not a git repository/);
  assert.equal((await observe(join(root, "missing"))).status, "broken");
  const bare = join(root, "bare.git");
  mkdirSync(bare);
  git(bare, "init", "--quiet", "--bare");
  // Outside a work tree Git refuses the toplevel half of the single rev-parse: still broken.
  for (const path of [bare, join(repo, ".git")]) {
    const result = await observe(path);
    assert.ok(result.status === "broken" && /bare repositories/.test(result.detail), path);
  }
});
