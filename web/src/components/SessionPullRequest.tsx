import type { PullRequest, SessionPullRequest } from "@shared/wire";
import {
  ArrowRightIcon,
  BookMarkedIcon,
  CheckIcon,
  ClockIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/PianoDialog";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { StatusBadge as Badge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import type { useSessionPullRequest } from "@/lib/useSessionPullRequest";

const states = {
  open: { label: "Open", Icon: GitPullRequestIcon, color: "text-ok", variant: "success" },
  draft: {
    label: "Draft",
    Icon: GitPullRequestDraftIcon,
    color: "text-muted-foreground",
    variant: "secondary",
  },
  merged: { label: "Merged", Icon: GitMergeIcon, color: "text-merged", variant: "merged" },
  closed: { label: "Closed", Icon: GitPullRequestClosedIcon, color: "text-err", variant: "error" },
} as const;

/** One associated PR, not transcript references or a decorative link stack. */
function SessionPullRequestTrigger({ value }: { value: SessionPullRequest | undefined }) {
  const mobile = useIsMobile();
  const pr = value?.pullRequest;
  const status = pr ? states[pr.state] : undefined;
  const Icon = status?.Icon ?? GitPullRequestIcon;
  const number = pr?.number ?? value?.link?.url.split("/").pop();
  return (
    <Tooltip>
      <PopoverTrigger asChild>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={mobile ? "xs" : "lg"}
            aria-label={number ? `Pull request #${number}` : "PR"}
            aria-description={number ? (status?.label ?? "Status unavailable") : undefined}
          >
            <Icon
              data-icon="inline-start"
              className={status?.color ?? "text-muted-foreground"}
              aria-hidden
            />{" "}
            {number ? `#${number}` : "PR"}
          </Button>
        </TooltipTrigger>
      </PopoverTrigger>
      <TooltipContent className="max-w-80">
        <p className="text-wrap">{pr?.title ?? "Pull request"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Checks and reviews matter while work is open, not after its final disposition. */
function PullRequestSignals({ pr }: { pr: PullRequest }) {
  if (pr.state !== "open" && pr.state !== "draft") return null;
  const checks = {
    none: null,
    pending: { label: "Checks running", Icon: ClockIcon, color: "text-muted-foreground" },
    success: { label: "Checks passed", Icon: CheckIcon, color: "text-ok" },
    failure: { label: "Checks failed", Icon: XCircleIcon, color: "text-err" },
  }[pr.checks];
  const review = {
    none: null,
    approved: { label: "Approved", Icon: CheckIcon, color: "text-ok" },
    changes_requested: { label: "Changes requested", Icon: MessageSquareIcon, color: "text-err" },
    review_required: {
      label: "Review required",
      Icon: MessageSquareIcon,
      color: "text-muted-foreground",
    },
  }[pr.review];
  if (!checks && !review) return null;
  // Plain supporting facts, rather than competing status badges; only the icon carries the outcome color.
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      {[checks, review].map(
        (signal) =>
          signal && (
            <span key={signal.label} className="flex items-center gap-1.5">
              <signal.Icon className={`size-3 shrink-0 ${signal.color}`} aria-hidden />
              {signal.label}
            </span>
          ),
      )}
    </div>
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
}

/** Size of the change, as GitHub's PR header puts it: files changed, then lines added and removed. */
function DiffStat({
  additions,
  deletions,
  changedFiles,
}: {
  additions: number;
  deletions: number;
  changedFiles: number;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs tabular-nums">
      <FileDiffIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="mr-1.5 text-muted-foreground">
        {changedFiles.toLocaleString()} {changedFiles === 1 ? "file" : "files"} changed
      </span>
      <span className="font-medium text-ok">
        <span className="sr-only">Additions </span>+{additions.toLocaleString()}
      </span>
      <span className="font-medium text-err">
        <span className="sr-only">Deletions </span>−{deletions.toLocaleString()}
      </span>
    </div>
  );
}

/** Where, how big and how ready: the facts that decide whether to open the PR. */
function PullRequestFacts({ pr }: { pr: PullRequest }) {
  const hasDiff =
    pr.additions !== undefined && pr.deletions !== undefined && pr.changedFiles !== undefined;
  const signals =
    (pr.state === "open" || pr.state === "draft") && (pr.checks !== "none" || pr.review !== "none");
  if (!pr.head && !hasDiff && !signals) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {pr.head && pr.base && (
        <div
          className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground"
          title={`${pr.head} into ${pr.base}`}
        >
          <GitBranchIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{pr.head}</span>
          <ArrowRightIcon className="size-3 shrink-0" aria-label="into" />
          <span className="shrink-0">{pr.base}</span>
        </div>
      )}
      {hasDiff && (
        <DiffStat
          additions={pr.additions!}
          deletions={pr.deletions!}
          changedFiles={pr.changedFiles!}
        />
      )}
      <PullRequestSignals pr={pr} />
    </div>
  );
}

type PullRequestControl = ReturnType<typeof useSessionPullRequest>;

export function SessionPullRequestControl({
  open,
  onOpenChange,
  pr,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pr: PullRequestControl;
}) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const link = pr.value?.link;
  const pullRequest = pr.value?.pullRequest;
  const showingDetails = !!link && !editing;
  const status = pullRequest ? states[pullRequest.state] : undefined;
  const repo =
    pullRequest?.repo ?? (link ? new URL(link.url).pathname.split("/").slice(1, 3).join("/") : "");
  const number = pullRequest?.number ?? link?.url.split("/").pop();
  // Opening samples the latest link and refresh function. Background observations must not
  // restart linking, reset an edit, or trigger a refresh -> observation -> refresh loop.
  const opened = useEffectEvent(() => {
    if (!link) setLinking(true);
    else void pr.refresh();
  });
  useEffect(() => {
    if (!open) {
      setEditing(false);
      setLinking(false);
    } else opened();
  }, [open]);
  // A discovered or manually linked PR reveals the header, not a second overlay.
  useEffect(() => {
    if (open && linking && link) onOpenChange(false);
  }, [open, linking, link, onOpenChange]);
  // Cancel and successful discovery replace the focused form controls.
  useEffect(() => {
    if (open && showingDetails) closeRef.current?.focus();
  }, [open, showingDetails]);
  const close = () => onOpenChange(false);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const selector = pr.value?.link
      ? 'header [data-slot="popover-trigger"]'
      : 'header [aria-label="Session information and actions"]';
    document.querySelector<HTMLButtonElement>(selector)?.focus();
  };
  return (
    <>
      <Dialog open={open && (!link || linking)} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-sm"
          aria-describedby={undefined}
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader>
            <DialogTitle>Pull request</DialogTitle>
          </DialogHeader>
          <PullRequestForm pr={pr} editing={false} onCancel={close} onSave={close} />
        </DialogContent>
      </Dialog>
      <Popover open={open && !!link && !linking} onOpenChange={onOpenChange}>
        {link && <SessionPullRequestTrigger value={pr.value} />}
        <PopoverContent
          onCloseAutoFocus={restoreFocus}
          align="start"
          sideOffset={8}
          collisionPadding={16}
          aria-labelledby={titleId}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto"
        >
          <PopoverHeader className="flex-row items-center justify-between gap-2">
            {showingDetails ? (
              <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <BookMarkedIcon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-all">
                  {repo} <span className="whitespace-nowrap">· #{number}</span>
                </span>
              </p>
            ) : (
              <PopoverTitle id={titleId}>Pull request</PopoverTitle>
            )}
            <Button
              ref={closeRef}
              variant="ghost"
              size="icon-xs"
              aria-label="Close pull request"
              onClick={close}
            >
              <XIcon />
            </Button>
          </PopoverHeader>
          {link && showingDetails ? (
            <>
              {/* Plain PR facts, not a second card inside the popover. */}
              <div className="flex min-w-0 flex-col gap-2">
                <PopoverTitle id={titleId}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-words hover:underline"
                  >
                    {pullRequest?.title ?? "View pull request"}
                  </a>
                </PopoverTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {status ? (
                    <Badge variant={status.variant}>
                      <status.Icon data-icon="inline-start" aria-hidden />
                      {status.label}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Status unavailable</Badge>
                  )}
                  {pullRequest && (pullRequest.author || pullRequest.at) && (
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {pullRequest.author && (
                        <>
                          <Avatar size="sm" className="size-4" aria-hidden>
                            <AvatarImage
                              src={`https://github.com/${pullRequest.author}.png?size=40`}
                              alt=""
                            />
                            <AvatarFallback>
                              {pullRequest.author.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-foreground">{pullRequest.author}</span>
                        </>
                      )}
                      {pullRequest.at && (
                        <span className="shrink-0">
                          {pullRequest.state === "open" || pullRequest.state === "draft"
                            ? `updated ${ago(pullRequest.at)}`
                            : ago(pullRequest.at)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
              {pullRequest && <PullRequestFacts pr={pullRequest} />}
              <Separator className="opacity-50" />
              {/* Pull the ghost buttons' padding out so their labels meet the content edge. */}
              <div className="-mr-2 -mb-1 flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={pr.busy}
                  onClick={() => setEditing(true)}
                >
                  Change link
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={pr.busy}
                  onClick={async () => {
                    if (await pr.change({ action: "remove" })) close();
                  }}
                >
                  Remove link
                </Button>
              </div>
            </>
          ) : (
            <PullRequestForm
              pr={pr}
              editing={editing}
              onCancel={() => (link ? setEditing(false) : close())}
              onSave={close}
            />
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

/** Mount a draft only when editing; background refreshes must not replace typed input. */
function PullRequestForm({
  pr,
  editing,
  onCancel,
  onSave,
}: {
  pr: PullRequestControl;
  editing: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [url, setUrl] = useState(pr.value?.link?.url ?? "");
  const [finding, setFinding] = useState(false);
  const find = async () => {
    setFinding(true);
    try {
      const result = await pr.change({ action: "discover" });
      // Only the explicit search reports absence; polling stays silent.
      if (result) {
        if (result.link) onSave();
        else if (!result.error) toast("No open PR found for this branch.");
      }
    } finally {
      setFinding(false);
    }
  };
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (await pr.change({ action: "link", url })) onSave();
      }}
      className="flex flex-col gap-4"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="session-pr-url" className="sr-only">
            PR URL
          </FieldLabel>
          <Input
            ref={inputRef}
            id="session-pr-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/…"
          />
        </Field>
      </FieldGroup>
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pr.busy || finding || !url.trim()}>
          {editing ? "Save link" : "Link"}
        </Button>
        {editing ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={pr.busy || finding}
            onClick={() => {
              void find();
            }}
          >
            <GitBranchIcon data-icon="inline-start" />
            {finding ? "Finding…" : "Find from branch"}
          </Button>
        )}
      </div>
    </form>
  );
}
