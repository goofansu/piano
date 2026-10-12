/**
 * What a session's linked pull request shows: identity, status, the facts that decide whether to
 * open it, and how long ago it last moved. Pure, so the popover and its trigger only render.
 */
import type { PullRequest, SessionPullRequest } from "@shared/wire";

export type SignalOutcome = Exclude<PullRequest["checks"] | PullRequest["review"], "none">;

export interface PullRequestView {
  url: string;
  /** GitHub's number, else the link's last path segment; absent when neither names one. */
  number: string | undefined;
  /** "owner/name", from GitHub or the link's path. */
  repo: string;
  /** Live GitHub facts; absent while the status is unavailable. */
  title: string | undefined;
  status: { state: PullRequest["state"]; label: string } | undefined;
  /** Open or draft: work still in progress, so checks and reviews matter. */
  active: boolean;
  author: string | undefined;
  /** Relative time of the last update, or of the close or merge once disposed. */
  timeLabel: string | undefined;
  branches: { head: string; base: string } | undefined;
  diff: { additions: number; deletions: number; changedFiles: number } | undefined;
  /** Checks then review, only while active and only when GitHub reports them. */
  signals: { outcome: SignalOutcome; label: string }[];
}

const STATE_LABELS = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" } as const;
const SIGNAL_LABELS: Record<SignalOutcome, string> = {
  pending: "Checks running",
  success: "Checks passed",
  failure: "Checks failed",
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
] as const;
function ago(iso: string, now: number) {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of UNITS)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
}

function repoFromUrl(url: string) {
  try {
    return new URL(url).pathname.split("/").slice(1, 3).join("/");
  } catch {
    return "";
  }
}

/** The view of a linked pull request; undefined while the session has no link. */
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
  const at = pr?.at && ago(pr.at, now);
  return {
    url: link.url,
    number: pr ? String(pr.number) : link.url.split("/").pop() || undefined,
    repo: pr?.repo ?? repoFromUrl(link.url),
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
