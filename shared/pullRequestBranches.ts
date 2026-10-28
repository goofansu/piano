import type { SessionPullRequestLink } from "./wire.ts";

/**
 * The facts of a session's pull request link that Changes compares by: GitHub's qualified
 * branches as last recorded. The server hints each Changes read with them and the browser reads
 * Changes again when they move, and the server records them when GitHub moves them, all through
 * this module, so none can disagree on which facts matter.
 */
export type PullRequestBranches = Pick<
  SessionPullRequestLink,
  "head" | "base" | "headRepo" | "baseRepo"
>;

export const pullRequestBranches = ({
  head,
  base,
  headRepo,
  baseRepo,
}: PullRequestBranches): PullRequestBranches => ({ head, base, headRepo, baseRepo });

/** The branches as one value: equal exactly when every fact Changes compares by is. */
export const pullRequestBranchesKey = (branches: PullRequestBranches): string =>
  JSON.stringify(pullRequestBranches(branches));
