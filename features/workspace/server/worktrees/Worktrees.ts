import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Effect } from "effect";
import { WorktreeError } from "../../../../server/shared/FolderWorktrees.ts";
import { cutText } from "../../../../shared/cutText.ts";
import {
  WORKTREE_CREATION_MS,
  type WorktreeDiscovery,
  type WorktreeFacts,
} from "../../../../shared/wire.ts";
import { type BranchHome, branchHomes, gitText, observeGit } from "../GitCheckout.ts";
import { branchRemote, githubRemote } from "../pull-requests/GitHubPullRequests.ts";

const git = (cwd: string, args: string[]): Effect.Effect<string, WorktreeError> =>
  gitText(cwd, args).pipe(Effect.mapError((e) => new WorktreeError({ detail: e.detail })));
const checkoutOf = (path: string) =>
  observeGit(path).pipe(
    Effect.flatMap((observed) =>
      observed.status === "broken"
        ? Effect.fail(new WorktreeError({ detail: observed.detail }))
        : Effect.succeed(observed.status === "checkout" && observed),
    ),
  );
export const checkoutHint = Effect.fn("Worktrees.checkoutHint")(function* (
  path: string,
  options: { readonly subjectOnly?: boolean } = {},
): Effect.fn.Return<{ readonly root?: string; readonly subject?: string }> {
  let root: string | undefined;
  if (!options.subjectOnly) {
    const observed = yield* observeGit(path, { timeout: 2000 });
    if (observed.status !== "checkout") return {};
    root = observed.toplevel;
  }
  const subject = yield* gitText(path, ["log", "-1", "--format=%s"], { timeout: 2000 }).pipe(
    Effect.map((out) => cutText(out.trim(), 120)),
    Effect.orElseSucceed(() => ""),
  );
  return { root, subject: subject || undefined };
});

function parseWorktrees(out: string): WorktreeFacts[] | undefined {
  const worktrees: WorktreeFacts[] = [];
  let current:
    | {
        path?: string;
        head?: string;
        branch: string | null;
        detached: boolean;
        bare: boolean;
        prunable: boolean;
      }
    | undefined;
  const finish = () => {
    if (!current) return true;
    const w = current;
    current = undefined;
    if (w.bare) return true;
    if (
      !w.path ||
      !isAbsolute(w.path) ||
      worktrees.some((other) => other.path === w.path) ||
      (w.branch === null) !== w.detached
    )
      return false;
    worktrees.push({
      path: w.path,
      branch: w.branch,
      detached: w.detached,
      prunable: w.prunable,
      ...(w.head ? { head: w.head } : {}),
    });
    return true;
  };
  for (const field of out.split("\0")) {
    if (field === "") {
      if (!finish()) return undefined;
      continue;
    }
    const [key, ...rest] = field.split(" "),
      value = rest.join(" ");
    if (key === "worktree") {
      if (!finish()) return undefined;
      current = { path: value, branch: null, detached: false, bare: false, prunable: false };
      continue;
    }
    if (!current) return undefined;
    if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "HEAD" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) && !/^0+$/.test(value))
      current.head = value;
    else if (key === "detached") current.detached = true;
    else if (key === "bare") current.bare = true;
    else if (key === "prunable") current.prunable = true;
  }
  return finish() ? worktrees : undefined;
}

export const listWorktrees = Effect.fn("Worktrees.listWorktrees")(function* (
  folder: string,
): Effect.fn.Return<WorktreeDiscovery> {
  const observedAt = new Date().toISOString();
  return yield* Effect.gen(function* () {
    const checkout = yield* checkoutOf(folder);
    if (!checkout) return { status: "non-git" as const, observedAt };
    const worktrees = parseWorktrees(yield* git(folder, ["worktree", "list", "--porcelain", "-z"]));
    if (!worktrees)
      return yield* new WorktreeError({
        detail:
          "Invalid git worktree list output. Refresh after checking the repository with git worktree list.",
      });
    const currentPath = checkout.toplevel;
    if (!worktrees.some((w) => w.path === currentPath))
      return yield* new WorktreeError({
        detail:
          "Git listed no worktree for this checkout. Refresh after checking git worktree list.",
      });
    const remote = yield* gitText(folder, ["remote", "get-url", "origin"], {
      userConfig: true,
    }).pipe(Effect.orElseSucceed(() => ""));
    const githubRepo = githubRemote(remote.trim())?.repo;
    const homes = yield* branchHomes(
      folder,
      worktrees.flatMap((w) => (w.branch ? [{ path: w.path, branch: w.branch }] : [])),
    ).pipe(Effect.orElseSucceed(() => new Map<string, BranchHome>()));
    const located = worktrees.map((w) => {
      const home = homes.get(w.path);
      const remote = home?.pushed ? branchRemote(home) : undefined;
      return remote?.on === "github" && remote.head
        ? { ...w, github: { repo: remote.head.repo, branch: remote.head.name } }
        : w;
    });
    return {
      status: "ready" as const,
      observedAt,
      currentPath,
      worktrees: located,
      githubRepo,
    };
  }).pipe(
    Effect.catchTag("WorktreeError", (e) =>
      Effect.succeed({
        status: "error" as const,
        observedAt,
        detail: `${e.detail}\nCheck the checkout and Git, then refresh. No current Git status is available.`,
      }),
    ),
  );
});

export const worktreeOwner = Effect.fn("Worktrees.worktreeOwner")(function* (
  path: string,
): Effect.fn.Return<
  { readonly root: string; readonly main: string; readonly branch: string | null } | null,
  WorktreeError
> {
  const checkout = yield* checkoutOf(path);
  if (!checkout) return null;
  const root = checkout.toplevel;
  const physical = yield* Effect.tryPromise({
    try: () => realpath(path),
    catch: (e) => new WorktreeError({ detail: String(e) }),
  });
  if (physical !== root) return null;
  const out = yield* git(root, ["worktree", "list", "--porcelain", "-z"]);
  const first = out.split("\0\0")[0]?.split("\0") ?? [];
  const main = first[0]?.startsWith("worktree ") ? first[0].slice("worktree ".length) : undefined;
  const worktrees = parseWorktrees(out);
  const current = worktrees?.find((w) => w.path === root);
  if (!main || !worktrees || !current)
    return yield* new WorktreeError({
      detail: "Invalid git worktree list output. Check the repository with git worktree list.",
    });
  if (main === root || first.includes("bare")) return null;
  return { root, main, branch: current.branch };
});

export const mainCheckoutOf = Effect.fn("Worktrees.mainCheckoutOf")(function* (
  path: string,
): Effect.fn.Return<string | null, WorktreeError> {
  const checkout = yield* checkoutOf(path);
  if (!checkout) return null;
  const owner = yield* worktreeOwner(checkout.toplevel);
  return owner?.main ?? checkout.toplevel;
});

const localBranch = (folder: string, ref: string) =>
  git(folder, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
const symbolicRef = (folder: string, ref: string) =>
  git(folder, ["symbolic-ref", "--quiet", ref]).pipe(
    Effect.map((out) => out.trim()),
    Effect.orElseSucceed(() => ""),
  );
const defaultBranch = Effect.fn("Worktrees.defaultBranch")(function* (main: string) {
  const remoteHead = yield* symbolicRef(main, "refs/remotes/origin/HEAD");
  const current = yield* symbolicRef(main, "HEAD");
  const candidates = [
    remoteHead.replace(/^refs\/remotes\/origin\//, "refs/heads/"),
    "refs/heads/main",
    "refs/heads/master",
    current,
  ];
  for (const ref of candidates)
    if (ref.startsWith("refs/heads/") && (yield* localBranch(main, ref))) return ref;
  return yield* new WorktreeError({
    detail:
      "No base branch found: origin has no default branch here, and there is no local main or master. Check out the base branch in the main checkout, then try again.",
  });
});

export const createWorktree = Effect.fn("Worktrees.createWorktree")(function* (
  folder: string,
  branch: string,
) {
  const main = yield* mainCheckoutOf(folder);
  if (!main)
    return yield* new WorktreeError({
      detail: "This folder is non-Git. Create a Git repository before creating a worktree.",
    });
  if (!branch || branch.startsWith("-") || branch !== branch.trim())
    return yield* new WorktreeError({ detail: "Enter a valid new branch name." });
  if (
    (yield* git(folder, ["check-ref-format", "--branch", branch])).trim() !== branch ||
    branch === "@"
  ) {
    return yield* new WorktreeError({
      detail: "Enter a literal new branch name, not a checkout shortcut.",
    });
  }
  if ((yield* git(folder, ["branch", "--list", branch])).trim())
    return yield* new WorktreeError({
      detail: `Branch ${branch} already exists. Enter a new branch name.`,
    });
  const baseRef = yield* defaultBranch(main);
  const path = `${main}.${branch.replace(/[\\/]/g, "-")}`;
  if (existsSync(path))
    return yield* new WorktreeError({
      detail: `${path} already exists. Remove it or choose another branch name.`,
    });
  yield* gitText(main, ["worktree", "add", "--quiet", "-b", branch, path, baseRef], {
    timeout: WORKTREE_CREATION_MS,
    userConfig: true,
    config: ["-c", "core.hooksPath=/dev/null"],
  }).pipe(
    Effect.mapError(
      (e) =>
        new WorktreeError({
          unconfirmed: true,
          detail: `${e.detail}\nCreation was not confirmed; a checkout or branch may remain. Check git worktree list before retrying.`,
        }),
    ),
  );
  return { path, branch, baseBranch: baseRef.slice("refs/heads/".length) };
});
