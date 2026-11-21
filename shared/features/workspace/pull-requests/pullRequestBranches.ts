import type { SessionPullRequestLink } from "../../../wire.ts";

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

export const pullRequestBranchesKey = (branches: PullRequestBranches): string =>
  JSON.stringify(pullRequestBranches(branches));
