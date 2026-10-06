import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from "lucide-react";
import type { PullRequest } from "@shared/wire";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";

/**
 * The session's pull requests as a set-aside pile above the composer: the newest card
 * in front, the others peeking out behind it. Hover or focus fans the pile open.
 */
export function PullRequestStack({ prs }: { prs: PullRequest[] }) {
  if (prs.length === 0) return null;
  return (
    <div className="px-4 md:px-6">
      <ul className="group/stack mx-auto flex w-full max-w-2xl animate-in flex-col-reverse fade-in-0 slide-in-from-bottom-2" aria-label="Pull requests">
        {prs.map((pr, i) => (
          <li
            key={pr.url}
            // Each card behind the front one tucks under by all but a sliver; the pile opens on hover.
            className={cn(
              "animate-in transition-[margin,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] fade-in-0 slide-in-from-bottom-2",
              i > 0 && "-mb-12 scale-x-(--tuck) group-hover/stack:mb-1.5 group-hover/stack:scale-x-100 group-focus-within/stack:mb-1.5 group-focus-within/stack:scale-x-100",
            )}
            style={{ zIndex: prs.length - i, "--tuck": String(1 - Math.min(i, 4) * 0.03) } as React.CSSProperties}
          >
            <Card pr={pr} />
          </li>
        ))}
      </ul>
    </div>
  );
}

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

const STATE: Record<PullRequest["state"], { icon: typeof GitPullRequestIcon; tint: string; word: string; variant: BadgeVariant }> = {
  open: { icon: GitPullRequestIcon, tint: "bg-ok/15 text-ok", word: "Open", variant: "success" },
  draft: { icon: GitPullRequestDraftIcon, tint: "bg-fill text-ink-2", word: "Draft", variant: "secondary" },
  merged: { icon: GitMergeIcon, tint: "bg-merged/15 text-merged", word: "Merged", variant: "secondary" },
  closed: { icon: GitPullRequestClosedIcon, tint: "bg-err-soft text-err", word: "Closed", variant: "destructive" },
};

const CHECKS: Record<PullRequest["checks"], { word: string; dot: string; variant: BadgeVariant } | null> = {
  none: null,
  pending: { word: "Checks running", dot: "animate-live bg-busy", variant: "warning" },
  success: { word: "Checks passed", dot: "bg-ok", variant: "success" },
  failure: { word: "Checks failed", dot: "bg-err", variant: "destructive" },
};

const REVIEW: Record<PullRequest["review"], { word: string; variant: BadgeVariant } | null> = {
  none: null,
  approved: { word: "Approved", variant: "success" },
  changes_requested: { word: "Changes requested", variant: "warning" },
  review_required: { word: "Review required", variant: "outline" },
};

function Card({ pr }: { pr: PullRequest }) {
  const s = STATE[pr.state];
  const Icon = s.icon;
  const checks = pr.state === "open" || pr.state === "draft" ? CHECKS[pr.checks] : null;
  const review = pr.state === "open" ? REVIEW[pr.review] : null;
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className="flex h-14 items-center gap-3 rounded-xl border border-line bg-surface-1 px-3 text-sm shadow-1 outline-none transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-2 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", s.tint)} aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{pr.title}</span>
        <span className="flex items-center gap-2 truncate text-ink-2">
          <span className="truncate">{pr.repo} #{pr.number}</span>
          <Badge variant={s.variant}>{s.word}</Badge>
          {checks && (
            <Badge variant={checks.variant}>
              <span className={cn("size-1.5 rounded-full transition-colors duration-300", checks.dot)} aria-hidden />
              {checks.word}
            </Badge>
          )}
          {review && <Badge variant={review.variant}>{review.word}</Badge>}
        </span>
      </span>
    </a>
  );
}
