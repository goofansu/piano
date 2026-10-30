/** A linked worktree whose own config pushes its branch to a fork: remotes `origin` (up/repo) and
 * `fork` (me/fork), `extensions.worktreeConfig`, and in worktree `w` on `feat`,
 * `git config --worktree remote.pushDefault fork`. Git holds `feat` on both remotes, so only the
 * worktree's own config says which is the branch's home: me/fork, as `feat`. From the main
 * checkout Git would push `feat` to origin. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

export function forkWorktree(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-fork-worktree-")),
    repo = join(root, "repo"),
    worktree = join(root, "w");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(repo);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      {
        encoding: "utf8",
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
          ),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      },
    ).trim();
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "baseline");
  git(repo, "remote", "add", "origin", "https://github.com/up/repo.git");
  git(repo, "remote", "add", "fork", "https://github.com/me/fork.git");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(repo, "config", "extensions.worktreeConfig", "true");
  git(repo, "worktree", "add", "--quiet", "-b", "feat", worktree);
  git(worktree, "config", "--worktree", "remote.pushDefault", "fork");
  git(worktree, "commit", "--quiet", "--allow-empty", "-m", "work");
  git(repo, "update-ref", "refs/remotes/origin/feat", "feat");
  git(repo, "update-ref", "refs/remotes/fork/feat", "feat");
  return { root, repo, worktree, git };
}
