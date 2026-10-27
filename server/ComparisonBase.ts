/**
 * What Changes compares a checkout's working tree with. Git alone answers, plus two identities
 * Piano holds: the base of the session's pull request and the base branch Worktrunk reported when
 * Piano created the worktree. Nothing is fetched: a target is whatever Git holds locally, and a
 * scope Git cannot answer for is unavailable with its reason, never another comparison (INV-06).
 */
import type {
  ChangesScope,
  Comparison,
  ComparisonTarget,
  ScopeAvailability,
} from "../shared/wire.ts";
import type { Checkout } from "./GitCheckout.ts";

/** Identities Piano holds that name a branch's target, in the order they are tried. */
export interface TargetHints {
  /** The pull request's branches as GitHub last reported them; used only when `head` is the
   * checked-out branch, so a link to another branch's pull request never retargets Changes. */
  readonly pullRequest?: { readonly head: string; readonly base: string };
  /** The base branch Worktrunk reported when Piano created this worktree. */
  readonly worktreeBase?: string;
}

/** Every scope resolved for one checkout: what each would compare with, or why it cannot. */
export interface Comparisons {
  readonly head: string | null;
  readonly branch: string | null;
  readonly scopes: ScopeAvailability[];
  /** The comparison for `scope`, or the reason it is unavailable. */
  readonly of: (scope: ChangesScope) => { comparison: Comparison } | { unavailable: string };
  /** The scope Changes opens on when none was chosen: `branch` when it can be read. */
  readonly automatic: ChangesScope;
}

/** The commit `ref` names, or null when Git holds no such ref. */
const commitOf = async (checkout: Checkout, ref: string): Promise<string | null> => {
  const result = await checkout.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    okCodes: [0, 1],
  });
  return result.code === 0 ? result.stdout.toString("utf8").trim() || null : null;
};

/** The remote the branch tracks, else `origin`. */
async function trackingRemote(checkout: Checkout, branch: string): Promise<string> {
  const remote = (
    await checkout.text(["for-each-ref", "--format=%(upstream:remotename)", `refs/heads/${branch}`])
  ).trim();
  return remote && remote !== "." ? remote : "origin";
}

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
 * base when the pull request's head is this branch; the worktree's base at creation; the
 * remote's default branch; a local `main` or `master`, assumed.
 */
async function resolveTarget(
  checkout: Checkout,
  branch: string,
  hints: TargetHints,
): Promise<ComparisonTarget | null> {
  const remote = await trackingRemote(checkout, branch);
  if (hints.pullRequest && hints.pullRequest.head === branch) {
    const target = await namedTarget(checkout, remote, hints.pullRequest.base, "pull-request");
    if (target) return target;
  }
  if (hints.worktreeBase) {
    const target = await namedTarget(checkout, remote, hints.worktreeBase, "worktree");
    if (target) return target;
  }
  const fallback = await remoteDefault(checkout, remote);
  if (fallback) return fallback;
  for (const name of ["main", "master"]) {
    const commit = await commitOf(checkout, `refs/heads/${name}`);
    if (commit) return { name, ref: `refs/heads/${name}`, commit, from: "assumed" };
  }
  return null;
}

/** The `branch` scope for a checkout on `branch` at `head`: its comparison, or why there is none. */
async function branchScope(
  checkout: Checkout,
  head: string | null,
  branch: string | null,
  hints: TargetHints,
): Promise<{ comparison: Comparison } | { unavailable: string }> {
  if (!head) return { unavailable: "No commits yet." };
  if (!branch) return { unavailable: "Detached HEAD." };
  const target = await resolveTarget(checkout, branch, hints);
  if (!target) return { unavailable: "No base branch known." };
  if (target.name === branch) return { unavailable: `${branch} is the base branch.` };
  const bases = await checkout.run(["merge-base", "--all", target.commit, head], {
    okCodes: [0, 1],
  });
  const found = bases.stdout.toString("utf8").trim().split("\n").filter(Boolean);
  if (bases.code !== 0 || found.length === 0)
    return { unavailable: `No common history with ${target.name}.` };
  if (found.length > 1) return { unavailable: `Ambiguous merge base with ${target.name}.` };
  return { comparison: { scope: "branch", base: found[0]!, target } };
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
  const forBranch = await branchScope(checkout, head, branch, hints);
  const scopes: ScopeAvailability[] = [
    "comparison" in forBranch
      ? { scope: "branch", available: true, target: forBranch.comparison.target }
      : { scope: "branch", available: false, reason: forBranch.unavailable },
    { scope: "uncommitted", available: true },
  ];
  return {
    head,
    branch,
    scopes,
    of: (scope) => (scope === "uncommitted" ? { comparison: uncommitted } : forBranch),
    automatic: "comparison" in forBranch ? "branch" : "uncommitted",
  };
}
