import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Semaphore } from "effect";
import { observeCheckout, observeGit } from "../server/GitCheckout.ts";

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
    remoteBranch: null,
  });
  git(repo, "remote", "add", "origin", "git@github.com:example/repo.git");
  const tracked = await observe(repo, { remote: true });
  assert.ok(tracked.status === "checkout" && tracked.remote === "git@github.com:example/repo.git");
  assert.equal(tracked.remoteBranch, "main");
  // The branch's remote is where it pushes, not where it fetches.
  git(repo, "remote", "set-url", "--push", "origin", "git@github.com:me/fork.git");
  const pushed = await observe(repo, { remote: true });
  assert.ok(pushed.status === "checkout" && pushed.remote === "git@github.com:me/fork.git");

  const notes = join(root, "notes");
  mkdirSync(notes);
  assert.deepEqual(await observe(notes), { status: "non-git" });
  // Older Git says "not a git repository"; Git 2.56 names the invalid gitfile. Either way,
  // the `.git` entry makes this broken, not non-Git, and its diagnostic must survive.
  writeFileSync(join(notes, ".git"), "gitdir: /not/a/repository\n");
  const brokenFile = await observe(notes);
  assert.equal(brokenFile.status, "broken");
  assert.match(
    brokenFile.status === "broken" ? brokenFile.detail : "",
    /not a git repository|gitfile does not point to a valid repository/,
  );
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

test("INV-06: an observation that writes an index runs no configured filter driver or hook", async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-git-checkout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  writeFileSync(join(repo, ".gitattributes"), "* filter=trap\n");
  git(repo, "config", "filter.trap.clean", `touch ${join(root, "FILTER_RAN")}; cat`);
  git(repo, "config", "filter.trap.required", "true");
  mkdirSync(join(repo, ".git/hooks"), { recursive: true });
  writeFileSync(
    join(repo, ".git/hooks/post-index-change"),
    `#!/bin/sh\ntouch ${join(root, "HOOK_RAN")}\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(repo, "file"), "content\n");
  const slots = await Effect.runPromise(Semaphore.make(1));
  const add = (writes?: "index") =>
    Effect.runPromise(
      observeCheckout(
        { id: "w", folder: repo, path: repo },
        { slots, limit: 1024 * 1024, writes },
        async (checkout) => {
          const index = checkout.with({ env: { GIT_INDEX_FILE: join(root, `index-${writes}`) } });
          await index.run(["add", "--", "file"]);
          return "added";
        },
      ),
    );
  assert.equal((await add("index")).result, "added");
  assert.equal(existsSync(join(root, "FILTER_RAN")), false);
  assert.equal(existsSync(join(root, "HOOK_RAN")), false);
  // The same read without the option runs both, so the traps are live.
  assert.equal((await add()).result, "added");
  assert.equal(existsSync(join(root, "FILTER_RAN")), true);
  assert.equal(existsSync(join(root, "HOOK_RAN")), true);
});
