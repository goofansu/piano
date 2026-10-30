/**
 * What Changes compares a checkout's working tree with. Git alone answers, plus two identities
 * Piano holds: the base of the session's pull request and the base branch Worktrunk reported when
 * Piano created the worktree. Nothing is fetched: a target is whatever Git holds locally, and a
 * scope Git cannot answer for is unavailable with its reason, never another comparison (INV-06).
 */
import type { PullRequestBranches } from "../shared/pullRequestBranches.ts";
import type {
  ChangesScope,
  Comparison,
  ComparisonTarget,
  ScopeAvailability,
} from "../shared/wire.ts";
import type { BranchHome, Checkout, Upstream } from "./GitCheckout.ts";
import { type BranchHead, branchRemote, githubRemote, isFromBranch } from "./GitHubPullRequests.ts";

/** Identities Piano holds that name a branch's target, in the order they are tried. */
export interface TargetHints {
  /** GitHub's qualified branches. Unqualified legacy hints are accepted but cannot retarget. */
  readonly pullRequest?: PullRequestBranches;
  /** The base branch Worktrunk reported when Piano created this worktree. */
  readonly worktreeBase?: string;
}

/** Every scope resolved for one checkout: what each would compare with, or why it cannot. */
export interface Comparisons {
  readonly head: string | null;
  readonly branch: string | null;
  /** The hinted pull request was opened from this branch: its head, on the branch's remote. */
  readonly pullRequestFromBranch: boolean;
  readonly scopes: ScopeAvailability[];
  /** The comparison for `scope`, or the reason it is unavailable; `uncommitted` always has one. */
  readonly of: ((scope: "uncommitted") => { comparison: Comparison }) &
    ((scope: ChangesScope) => { comparison: Comparison } | { unavailable: string });
}

/** The commit `ref` names, or null when Git holds no such ref. */
const commitOf = async (checkout: Checkout, ref: string): Promise<string | null> => {
  const result = await checkout.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    okCodes: [0, 1],
  });
  return result.code === 0 ? result.stdout.toString("utf8").trim() || null : null;
};

/** The first of the named branch's refs Git holds: its remote-tracking ref, else the local one. */
async function namedTarget(
  checkout: Checkout,
  remote: string,
  name: string,
  from: ComparisonTarget["from"],
): Promise<ComparisonTarget | null> {
  for (const ref of [`refs/remotes/${remote}/${name}`, `refs/heads/${name}`]) {
    const commit = await commitOf(checkout, ref);
    if (commit) return { name, ref, commit, from };
  }
  return null;
}

/** The branch as GitHub knows it when `pr` was opened from it, else null: no PR came from a
 * branch whose remote is not on GitHub. Pushed or not: the PR's head is proof enough. */
function fromBranch(
  home: BranchHome,
  pr: NonNullable<TargetHints["pullRequest"]>,
): BranchHead | null {
  const remote = branchRemote(home);
  const head = remote.on === "github" ? remote.head : null;
  return head && isFromBranch(pr, head) ? head : null;
}

/** The base of a PR opened from this branch, held under a remote naming the base repository,
 * not a same-named local branch or fork ref. Missing proof falls through to the existing target
 * order; nothing is fetched. */
async function pullRequestTarget(
  checkout: Checkout,
  { remote }: Upstream,
  pr: NonNullable<TargetHints["pullRequest"]>,
): Promise<ComparisonTarget | null> {
  if (!pr.baseRepo || !pr.base) return null;
  // Hints can come from older/untrusted callers. A branch name must not become a rev expression.
  if (
    (await checkout.run(["check-ref-format", `refs/heads/${pr.base}`], { okCodes: [0, 1] }))
      .code !== 0
  )
    return null;
  const remotes = (await checkout.text(["remote"])).trim().split("\n").filter(Boolean);
  // Git fetched the base's ref, so the remote's fetch URL names its repository.
  for (const name of new Set([remote, ...remotes])) {
    if (githubRemote((await checkout.remoteUrl(name)) ?? "")?.repo !== pr.baseRepo) continue;
    const ref = `refs/remotes/${name}/${pr.base}`;
    const commit = await commitOf(checkout, ref);
    if (commit) return { name: pr.base, ref, commit, from: "pull-request" };
  }
  return null;
}

/** The remote's default branch as Git holds it locally (`refs/remotes/<remote>/HEAD`). */
async function remoteDefault(checkout: Checkout, remote: string): Promise<ComparisonTarget | null> {
  const result = await checkout.run(["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`], {
    okCodes: [0, 1],
  });
  if (result.code !== 0) return null;
  const ref = result.stdout.toString("utf8").trim();
  const prefix = `refs/remotes/${remote}/`;
  if (!ref.startsWith(prefix)) return null;
  const commit = await commitOf(checkout, ref);
  return commit ? { name: ref.slice(prefix.length), ref, commit, from: "remote-default" } : null;
}

/**
 * The target a branch is compared with, the first of these that Git holds: the pull request's
 * repository-qualified base when its head is this checkout's branch on its remote; the worktree's base at creation; the
 * remote's default branch; a local `main` or `master`, assumed.
 */
async function resolveTarget(
  checkout: Checkout,
  upstream: Upstream,
  head: BranchHead | null,
  hints: TargetHints,
): Promise<ComparisonTarget | null> {
  // The base lives where the branch started, which a fork's branch does not push to.
  const { tracked } = upstream;
  if (head && hints.pullRequest) {
    const target = await pullRequestTarget(checkout, upstream, hints.pullRequest);
    if (target) return target;
  }
  if (hints.worktreeBase) {
    const target = await namedTarget(checkout, tracked, hints.worktreeBase, "worktree");
    if (target) return target;
  }
  const fallback = await remoteDefault(checkout, tracked);
  if (fallback) return fallback;
  for (const name of ["main", "master"]) {
    const commit = await commitOf(checkout, `refs/heads/${name}`);
    if (commit) return { name, ref: `refs/heads/${name}`, commit, from: "assumed" };
  }
  return null;
}

/** The `branch` scope for a checkout on `branch` at `head`: its comparison, or why there is none.
 * `pullRequestHead` is the branch as GitHub knows it when the hinted PR was opened from it. */
async function branchScope(
  checkout: Checkout,
  head: string | null,
  branch: { readonly name: string; readonly upstream: Upstream } | null,
  pullRequestHead: BranchHead | null,
  hints: TargetHints,
): Promise<{ comparison: Comparison } | { unavailable: string; target?: ComparisonTarget }> {
  if (!head) return { unavailable: "No commits yet." };
  if (!branch) return { unavailable: "Detached HEAD." };
  const target = await resolveTarget(checkout, branch.upstream, pullRequestHead, hints);
  if (!target) return { unavailable: "No base branch known." };
  // This branch by ref, not name: a fork's PR into a same-named base is another branch, and a
  // branch that pushes to its target under another name (`push.default=upstream`) is not it.
  const { upstream } = branch;
  if (
    target.ref === `refs/heads/${branch.name}` ||
    (target.ref === upstream.ref && upstream.name === branch.name)
  )
    return { unavailable: `${branch.name} is the base branch.`, target };
  const bases = await checkout.run(["merge-base", "--all", target.commit, head], {
    okCodes: [0, 1],
  });
  const found = bases.stdout.toString("utf8").trim().split("\n").filter(Boolean);
  if (bases.code !== 0 || found.length === 0)
    return { unavailable: `No common history with ${target.name}.`, target };
  if (found.length > 1) return { unavailable: `Ambiguous merge base with ${target.name}.`, target };
  return { comparison: { scope: "branch", base: found[0]!, target } };
}

/**
 * What of the branch is still only here: commits its remote-tracking ref does not have, as Git
 * holds that ref locally (no fetch), or null when there is no such ref to compare with.
 */
export async function commitsNotPushed(
  checkout: Checkout,
  head: string | null,
  branch: string | null,
): Promise<number | null> {
  if (!head || !branch) return null;
  const { ref } = await checkout.upstream(branch);
  if (!(await commitOf(checkout, ref))) return null;
  const count = (await checkout.text(["rev-list", "--count", `${ref}..${head}`])).trim();
  return Number(count) || 0;
}

/** Resolve every scope for the checkout once; `of` then answers for the one asked for. */
export async function resolveComparisons(
  checkout: Checkout,
  hints: TargetHints = {},
): Promise<Comparisons> {
  const head = await checkout.head();
  const branch = await checkout.branch();
  const uncommitted: Comparison = {
    scope: "uncommitted",
    base:
      head ??
      (
        await checkout.text(["hash-object", "-w", "-t", "tree", "--stdin"], {
          input: Buffer.alloc(0),
        })
      ).trim(),
  };
  const home = branch ? await checkout.home(branch) : null;
  const upstream = home?.upstream ?? null;
  const pullRequestHead = home && hints.pullRequest ? fromBranch(home, hints.pullRequest) : null;
  const forBranch = await branchScope(
    checkout,
    head,
    branch && upstream ? { name: branch, upstream } : null,
    pullRequestHead,
    hints,
  );
  const scopes: ScopeAvailability[] = [
    "comparison" in forBranch
      ? { scope: "branch", available: true, target: forBranch.comparison.target }
      : {
          scope: "branch",
          available: false,
          reason: forBranch.unavailable,
          ...(forBranch.target ? { target: forBranch.target } : {}),
        },
    { scope: "uncommitted", available: true },
  ];
  const of = (scope: ChangesScope) =>
    scope === "uncommitted" ? { comparison: uncommitted } : forBranch;
  return {
    head,
    branch,
    pullRequestFromBranch: pullRequestHead !== null,
    scopes,
    of: of as Comparisons["of"],
  };
}
