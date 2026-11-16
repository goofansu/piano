import type { PullRequestBranches } from "../shared/pullRequestBranches.ts";
import type {
  ChangesScope,
  Comparison,
  ComparisonTarget,
  ScopeAvailability,
} from "../shared/wire.ts";
import type { BranchHome, Checkout, Upstream } from "./GitCheckout.ts";
import { type BranchHead, branchRemote, githubRemote, isFromBranch } from "./GitHubPullRequests.ts";

export interface TargetHints {
  readonly pullRequest?: PullRequestBranches;
  readonly worktreeBase?: string;
}

export interface Comparisons {
  readonly head: string | null;
  readonly branch: string | null;
  readonly pushed: string | null;
  readonly pullRequestFromBranch: boolean;
  readonly scopes: ScopeAvailability[];
  readonly of: ((scope: "uncommitted") => { comparison: Comparison }) &
    ((scope: ChangesScope) => { comparison: Comparison } | { unavailable: string });
}

const commitOf = async (checkout: Checkout, ref: string): Promise<string | null> => {
  const result = await checkout.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    okCodes: [0, 1],
  });
  return result.code === 0 ? result.stdout.toString("utf8").trim() || null : null;
};

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

function fromBranch(
  home: BranchHome,
  pr: NonNullable<TargetHints["pullRequest"]>,
): BranchHead | null {
  const remote = branchRemote(home);
  const head = remote.on === "github" ? remote.head : null;
  return head && isFromBranch(pr, head) ? head : null;
}

async function pullRequestTarget(
  checkout: Checkout,
  { remote }: Upstream,
  pr: NonNullable<TargetHints["pullRequest"]>,
): Promise<ComparisonTarget | null> {
  if (!pr.baseRepo || !pr.base) return null;
  if (
    (await checkout.run(["check-ref-format", `refs/heads/${pr.base}`], { okCodes: [0, 1] }))
      .code !== 0
  )
    return null;
  const remotes = (await checkout.text(["remote"])).trim().split("\n").filter(Boolean);
  for (const name of new Set([remote, ...remotes])) {
    if (githubRemote((await checkout.remoteUrl(name)) ?? "")?.repo !== pr.baseRepo) continue;
    const ref = `refs/remotes/${name}/${pr.base}`;
    const commit = await commitOf(checkout, ref);
    if (commit) return { name: pr.base, ref, commit, from: "pull-request" };
  }
  return null;
}

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

async function resolveTarget(
  checkout: Checkout,
  upstream: Upstream,
  head: BranchHead | null,
  hints: TargetHints,
): Promise<ComparisonTarget | null> {
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

export async function commitsNotPushed(
  checkout: Checkout,
  { head, pushed }: Pick<Comparisons, "head" | "pushed">,
): Promise<number | null> {
  if (!head || !pushed) return null;
  const count = (await checkout.text(["rev-list", "--count", `${pushed}..${head}`])).trim();
  return Number(count) || 0;
}

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
    pushed: home?.pushed && upstream ? upstream.ref : null,
    pullRequestFromBranch: pullRequestHead !== null,
    scopes,
    of: of as Comparisons["of"],
  };
}
