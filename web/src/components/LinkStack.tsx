import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRightIcon, CheckIcon, CircleDotIcon, CopyIcon, FileCodeIcon, FolderGitIcon, GitCommitHorizontalIcon, GitCompareIcon,
  GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, MessageSquareTextIcon, MonitorIcon, PlayIcon,
} from "lucide-react";
import type { PullRequest } from "@shared/wire";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionLink } from "@/lib/links";
import { jumpTo } from "@/lib/transcript";

/**
 * The links a session mentions, as a set-aside pile above the composer: at hand, out of the
 * way. The newest card sits in front with the others peeking out behind it. Pointer hover or
 * keyboard focus fans the pile open; on a touch screen the first tap does. Each fanned card
 * opens its link, can show where the conversation mentioned it, or copy it. The pile is a
 * view of the transcript and keeps no state of its own.
 */
export function LinkStack({ links }: { links: SessionLink[] }) {
  const [tapped, setTapped] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const root = useRef<HTMLUListElement>(null);
  const open = tapped && links.length > 1;
  const fanned = open || hover || focus;
  // A tapped-open pile closes on Escape or a tap elsewhere, the way a menu would.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setTapped(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setTapped(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  if (links.length === 0) return null;
  return (
    <div className="px-4 md:px-6">
      {/* Only the cards themselves react to the pointer, not the empty space beside them. */}
      <ul
        ref={root}
        className="mx-auto flex w-full max-w-2xl animate-in flex-col-reverse fade-in-0 slide-in-from-bottom-2"
        aria-label="Links"
        data-fanned={fanned || undefined}
        data-slot="link-stack"
        onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(true); }}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }}
      >
        {links.map((link, i) => (
          <li
            key={link.url}
            // Behind the front card each one tucks under by all but a sliver, a little narrower and
            // darker with depth; cards stay opaque so nothing shows through. Fanning opens them in a
            // short cascade from the front.
            className={cn(
              "link-card group/card relative flex h-16 items-center rounded-2xl border border-line",
              "animate-in slide-in-from-bottom-2 hover:-translate-y-px hover:border-line-strong",
              "has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-surface-0",
              i > 0 && (fanned ? "mb-2" : "-mb-14 scale-x-(--tuck) brightness-(--depth)"),
            )}
            style={{
              zIndex: links.length - i,
              transitionDelay: fanned ? `${Math.min(i, 6) * 25}ms` : "0ms",
              "--tuck": String(1 - Math.min(i, 4) * 0.035),
              "--depth": String(1 - Math.min(i, 4) * 0.04),
            } as React.CSSProperties}
          >
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`${link.title}, ${link.detail}`}
              tabIndex={fanned || i === 0 ? 0 : -1}
              className="flex h-full min-w-0 flex-1 items-center gap-3.5 rounded-2xl pl-3 pr-3.5 text-sm outline-none"
              onClick={(e) => {
                // Without hover there is no fan on the way to a click: the first tap opens the pile.
                if (!fanned && links.length > 1 && !window.matchMedia("(hover: hover)").matches) { e.preventDefault(); setTapped(true); }
              }}
            >
              <Mark link={link} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex items-center gap-1 text-ink">
                  <span className="truncate font-medium">{link.title}</span>
                  <ArrowUpRightIcon className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100" aria-hidden />
                </span>
                <Detail link={link} />
              </span>
            </a>
            {fanned ? (
              <Actions link={link} />
            ) : (
              i === 0 && links.length > 1 && <span className="mr-4 text-xs tabular-nums text-ink-3" aria-hidden>{links.length}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Show where it was said, or copy it. Visible while the card is hovered or focused. */
function Actions({ link }: { link: SessionLink }) {
  const [copied, setCopied] = useState(false);
  const action = "size-8 rounded-lg text-ink-3 hover:bg-fill-hover hover:text-ink";
  return (
    <span className="flex shrink-0 items-center gap-1 pr-2.5 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={action} aria-label="Show in conversation" onClick={() => jumpTo({ kind: "assistant", id: link.messageId, label: link.title, messageId: link.messageId })}>
            <MessageSquareTextIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Show in conversation</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={action}
            aria-label={copied ? "Copied" : "Copy link"}
            onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}
          >
            {copied ? <CheckIcon className="text-ok" /> : <CopyIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : "Copy link"}</TooltipContent>
      </Tooltip>
    </span>
  );
}

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

const PR_STATE: Record<PullRequest["state"], { icon: typeof GitPullRequestIcon; tint: string; word: string; variant: BadgeVariant }> = {
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

const KIND_ICON: Partial<Record<SessionLink["kind"], typeof GitPullRequestIcon>> = {
  pull_request: GitPullRequestIcon,
  issue: CircleDotIcon,
  commit: GitCommitHorizontalIcon,
  compare: GitCompareIcon,
  run: PlayIcon,
  code: FileCodeIcon,
  repo: FolderGitIcon,
  local: MonitorIcon,
};

/** A stable hue per host, so the same site always wears the same colour. */
function hue(host: string): number {
  let h = 0;
  for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** The card's left mark: a forge icon tinted by state, a monitor for a local server, or the site's monogram. */
function Mark({ link }: { link: SessionLink }) {
  const circle = "flex size-10 shrink-0 items-center justify-center rounded-xl";
  const s = link.status;
  if (s?._tag === "pull_request") {
    const Icon = PR_STATE[s.state].icon;
    return <span className={cn(circle, PR_STATE[s.state].tint)} aria-hidden><Icon className="size-4" /></span>;
  }
  if (link.kind === "web") {
    return (
      <span className={cn(circle, "link-monogram text-sm font-semibold uppercase")} style={{ "--hue": hue(link.host) } as React.CSSProperties} aria-hidden>
        {link.host.charAt(0)}
      </span>
    );
  }
  const Icon = KIND_ICON[link.kind] ?? CircleDotIcon;
  const tint = s?._tag === "issue" ? (s.state === "open" ? "bg-ok/15 text-ok" : "bg-merged/15 text-merged") : "bg-fill text-ink-2";
  return <span className={cn(circle, tint)} aria-hidden><Icon className="size-4" /></span>;
}

/** The second line: where the link points, with live state for a pull request or issue. */
function Detail({ link }: { link: SessionLink }) {
  const s = link.status;
  const pr = s?._tag === "pull_request" ? s : undefined;
  const checks = pr && (pr.state === "open" || pr.state === "draft") ? CHECKS[pr.checks] : null;
  const review = pr?.state === "open" ? REVIEW[pr.review] : null;
  return (
    <span className="mt-1 flex items-center gap-2 truncate text-xs text-ink-3">
      <span className="truncate">{link.detail}</span>
      {pr && <Badge variant={PR_STATE[pr.state].variant}>{PR_STATE[pr.state].word}</Badge>}
      {checks && (
        <Badge variant={checks.variant}>
          <span className={cn("size-1.5 rounded-full transition-colors duration-300", checks.dot)} aria-hidden />
          {checks.word}
        </Badge>
      )}
      {review && <Badge variant={review.variant}>{review.word}</Badge>}
      {s?._tag === "issue" && <Badge variant={s.state === "open" ? "success" : "secondary"}>{s.state === "open" ? "Open" : "Closed"}</Badge>}
    </span>
  );
}
