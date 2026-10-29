/**
 * What a session's linked pull request shows: identity, status, the facts that decide whether to
 * open it, and how long ago it last moved; the trigger's face and the link form's wording and
 * submit rule. Pure, so the popover, its trigger and the form only render.
 */

import type { LocalWork, PullRequest, SessionPullRequest } from "@shared/wire";
import { pullRequestIdentity } from "../../../shared/pullRequestIdentity.ts";
import { localWorkFacts } from "./changesView.ts";
import { timeAgo } from "./format.ts";
import { canLink } from "./sessionPullRequest.ts";

export type SignalOutcome = Exclude<PullRequest["checks"] | PullRequest["review"], "none">;

export interface PullRequestView {
  url: string;
  /** What every surface calls it: its number ("42"), else "PR" when the link names none. */
  name: string;
  /** "owner/name#42", for copying; absent when the link names no pull request. */
  reference: string | undefined;
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
  const at = pr?.at && timeAgo(pr.at, now);
  // GitHub's facts name it once read; until then the link names it, as the server parses links.
  const identity = pr ?? pullRequestIdentity(link.url);
  return {
    url: link.url,
    name: identity ? String(identity.number) : "PR",
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

/** Shown wherever a linked PR's live GitHub status could not be read. */
export const STATUS_UNAVAILABLE = "Status unavailable";

/** The row under the Changes toolbar: the pull request, its state and what is still only local. */
export interface PullRequestRow {
  /** The view's name. */
  name: string;
  title: string | undefined;
  url: string;
  /** No badge during the first read; an unreadable status still has one. */
  status: { state: PullRequest["state"] | undefined; label: string } | undefined;
  signals: PullRequestView["signals"];
  /** The pull request's branches, only when it was not opened from the branch Changes inspects. */
  branches: PullRequestView["branches"];
  /** Values, each shown only when nonzero: commits not pushed, edits not committed. */
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
  /** The submit button and Enter both follow this; `link` refuses whatever it rejects. */
  canSubmit: boolean;
  submitLabel: string;
  /** Changing a link offers Cancel; linking one offers Find from branch, idle unless busy. */
  secondary:
    | { action: "cancel"; label: string }
    | { action: "find"; label: string; disabled: boolean };
}

/** The link form: a draft URL, linked anew or replacing the saved link while `editing`. */
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
