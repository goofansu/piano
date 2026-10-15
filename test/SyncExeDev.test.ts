import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve(".agents/skills/sync-exe-dev/scripts/deploy.sh");

test("sync-exe-dev freezes the target and preserves dirty and ahead checkouts", () => {
  const root = mkdtempSync(join(tmpdir(), "piano-sync-test-"));
  const origin = join(root, "origin");
  const checkout = join(root, "checkout");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Sync test",
    GIT_AUTHOR_EMAIL: "sync@example.invalid",
    GIT_COMMITTER_NAME: "Sync test",
    GIT_COMMITTER_EMAIL: "sync@example.invalid",
  };
  const run = (cwd: string, command: string, ...args: string[]) =>
    spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 30_000 });
  const git = (cwd: string, ...args: string[]) => {
    const result = run(cwd, "git", ...args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const sync = (target: string) => run(root, "bash", script, "local", target, checkout);
  try {
    git(root, "init", "-b", "main", origin);
    writeFileSync(
      join(origin, "package.json"),
      JSON.stringify({
        name: "sync-fixture",
        version: "1.0.0",
        scripts: { build: "node -e \"console.log('SCRATCH BUILD OK')\"" },
      }),
    );
    writeFileSync(
      join(origin, "package-lock.json"),
      JSON.stringify({
        name: "sync-fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "sync-fixture", version: "1.0.0" } },
      }),
    );
    git(origin, "add", ".");
    git(origin, "commit", "-m", "base");
    git(root, "clone", origin, checkout);
    writeFileSync(join(origin, "revision.txt"), "frozen target\n");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "target");
    const target = git(origin, "rev-parse", "HEAD");
    writeFileSync(join(origin, "revision.txt"), "newer main\n");
    git(origin, "commit", "-am", "newer main");

    const before = git(checkout, "rev-parse", "HEAD");
    writeFileSync(join(checkout, "unsaved.txt"), "preserve me\n");
    const dirty = sync(target);
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /BLOCKED: dirty checkout/);
    assert.equal(git(checkout, "rev-parse", "HEAD"), before);
    assert.equal(readFileSync(join(checkout, "unsaved.txt"), "utf8"), "preserve me\n");
    rmSync(join(checkout, "unsaved.txt"));

    const success = sync(target);
    assert.equal(success.status, 0, success.stdout + success.stderr);
    assert.match(success.stdout, /SCRATCH BUILD OK/);
    assert.ok(success.stdout.includes(`READY ${target}`));
    assert.equal(git(checkout, "rev-parse", "HEAD"), target);
    assert.equal(readFileSync(join(checkout, "revision.txt"), "utf8"), "frozen target\n");
    assert.equal(git(checkout, "status", "--porcelain"), "");

    git(checkout, "merge", "--ff-only", "origin/main");
    const ahead = git(checkout, "rev-parse", "HEAD");
    const blocked = sync(target);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /BLOCKED: ahead, divergent, or target unavailable/);
    assert.equal(git(checkout, "rev-parse", "HEAD"), ahead);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
