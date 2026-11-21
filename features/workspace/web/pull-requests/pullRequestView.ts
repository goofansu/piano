import type { LocalWork, PullRequest, SessionPullRequest } from "@shared/wire";
import { pullRequestIdentity } from "../../../../shared/git/pullRequestIdentity.ts";
import { timeAgo } from "../../../../web/src/shared/lib/format.ts";
import { localWorkFacts } from "../changes/changesView.ts";
import { canLink } from "./pullRequestState.ts";

export type SignalOutcome = Exclude<PullRequest["checks"] | PullRequest["review"], "none">;

export interface PullRequestView {
  url: string;
  name: string;
  reference: string | undefined;
  title: string | undefined;
  status: { state: PullRequest["state"]; label: string } | undefined;
  active: boolean;
  author: string | undefined;
  timeLabel: string | undefined;
  branches: { head: string; base: string } | undefined;
  diff: { additions: number; deletions: number; changedFiles: number } | undefined;
  signals: { outcome: SignalOutcome; label: string }[];
}

const STATE_LABELS = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" } as const;
const SIGNAL_LABELS: Record<SignalOutcome, string> = {
  unknown: "Checks unavailable",
  pending: "Checks running",
  success: "Checks passed",
  failure: "Checks failed",
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
};

export function pullRequestView(
  value: SessionPullRequest | undefined,
  now = Date.now(),
): PullRequestView | undefined {
  const link = value?.link;
  if (!link) return undefined;
  const pr = value.pullRequest ?? undefined;
  const active = pr?.state === "open" || pr?.state === "draft";
  const signals = active
    ? [pr.checks, pr.review].flatMap((outcome) =>
        outcome === "none" ? [] : [{ outcome, label: SIGNAL_LABELS[outcome] }],
      )
    : [];
  const at = pr?.at && timeAgo(pr.at, now);
  const identity = pr ?? pullRequestIdentity(link.url);
  return {
    url: link.url,
    name: identity ? `#${identity.number}` : "PR",
    reference: identity ? `${identity.repo}#${identity.number}` : undefined,
    title: pr?.title,
    status: pr && { state: pr.state, label: STATE_LABELS[pr.state] },
    active,
    author: pr?.author,
    timeLabel: at ? (active ? `updated ${at}` : at) : undefined,
    branches: pr?.head && pr.base ? { head: pr.head, base: pr.base } : undefined,
    diff:
      pr?.additions !== undefined && pr.deletions !== undefined && pr.changedFiles !== undefined
        ? { additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles }
        : undefined,
    signals,
  };
}

export const STATUS_UNAVAILABLE = "Status unavailable";

export interface PullRequestRow {
  name: string;
  title: string | undefined;
  url: string;
  status: { state: PullRequest["state"] | undefined; label: string } | undefined;
  signals: PullRequestView["signals"];
  branches: PullRequestView["branches"];
  local: string[];
}

export function pullRequestRow(
  view: PullRequestView,
  {
    fromBranch,
    local,
    loading = false,
  }: { fromBranch: boolean | undefined; local: LocalWork | undefined; loading?: boolean },
): PullRequestRow {
  const { status } = view;
  return {
    name: view.name,
    title: view.title,
    url: view.url,
    status: status ?? (loading ? undefined : { state: undefined, label: STATUS_UNAVAILABLE }),
    signals: view.signals,
    branches: fromBranch ? undefined : view.branches,
    local: localWorkFacts(local),
  };
}

export interface PullRequestForm {
  canSubmit: boolean;
  submitLabel: string;
  secondary:
    | { action: "cancel"; label: string }
    | { action: "find"; label: string; disabled: boolean };
}

export function pullRequestForm({
  url,
  busy,
  finding,
  editing,
}: {
  url: string;
  busy: boolean;
  finding: boolean;
  editing: boolean;
}): PullRequestForm {
  return {
    canSubmit: canLink(url, busy),
    submitLabel: editing ? "Save link" : "Link",
    secondary: editing
      ? { action: "cancel", label: "Cancel" }
      : { action: "find", label: finding ? "Finding…" : "Find from branch", disabled: busy },
  };
}
