import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Semaphore } from "effect";
import { branchHomes, observeCheckout, observeGit } from "../server/GitCheckout.ts";
import { forkWorktree } from "./fixtures/forkWorktree.ts";

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

  assert.deepEqual(await observe(join(repo, "subdirectory")), {
    status: "checkout",
    toplevel: repo,
  });
  assert.deepEqual(await observe(repo, { branch: true }), {
    status: "checkout",
    toplevel: repo,
    branch: "main",
  });
  git(repo, "checkout", "--quiet", "--detach");
  assert.deepEqual(await observe(repo, { branch: true }), {
    status: "checkout",
    toplevel: repo,
    branch: null,
  });
  git(repo, "checkout", "--quiet", "main");

  const notes = join(root, "notes");
  mkdirSync(notes);
  assert.deepEqual(await observe(notes), { status: "non-git" });
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
  assert.equal((await add()).result, "added");
  assert.equal(existsSync(join(root, "FILTER_RAN")), true);
  assert.equal(existsSync(join(root, "HOOK_RAN")), true);
});

test("INV-01: a branch's home is where Git would push it, by push URL, read in its own checkout", async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-git-home-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "baseline");
  const home = async (path = repo) => {
    const observed = await observe(path, { home: true });
    assert.equal(observed.status, "checkout");
    const h = observed.status === "checkout" ? observed.home : undefined;
    return (
      h && { remote: h.upstream?.remote, name: h.upstream?.name, url: h.url, pushed: h.pushed }
    );
  };
  assert.deepEqual(await home(), { remote: "origin", name: "main", url: null, pushed: false });
  git(repo, "remote", "add", "origin", "git@github.com:example/repo.git");
  assert.deepEqual(await home(), {
    remote: "origin",
    name: "main",
    url: "git@github.com:example/repo.git",
    pushed: false,
  });
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  assert.equal((await home())?.pushed, true);
  git(repo, "remote", "set-url", "--push", "origin", "git@github.com:me/fork.git");
  assert.equal((await home())?.url, "git@github.com:me/fork.git");
  git(repo, "checkout", "--quiet", "--detach");
  assert.deepEqual(await home(), {
    remote: undefined,
    name: undefined,
    url: "git@github.com:me/fork.git",
    pushed: false,
  });

  const fork = forkWorktree(t);
  assert.deepEqual(await home(fork.worktree), {
    remote: "fork",
    name: "feat",
    url: "https://github.com/me/fork.git",
    pushed: true,
  });
  const homes = await Effect.runPromise(
    branchHomes(fork.repo, [
      { path: fork.repo, branch: "main" },
      { path: fork.worktree, branch: "feat" },
    ]),
  );
  const feat = homes.get(fork.worktree);
  assert.deepEqual(
    [feat?.upstream?.remote, feat?.url, feat?.pushed],
    ["fork", "https://github.com/me/fork.git", true],
  );
  assert.equal(homes.get(fork.repo)?.upstream?.remote, "origin");
  fork.git(fork.repo, "update-ref", "-d", "refs/remotes/fork/feat");
  assert.equal((await home(fork.worktree))?.pushed, false);
});
