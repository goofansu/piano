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
  type LucideIcon,
  MessageSquareIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
import {
  type PullRequestView,
  pullRequestForm,
  pullRequestTrigger,
  pullRequestView,
  type SignalOutcome,
  STATUS_UNAVAILABLE,
} from "@/lib/pullRequestView";
import { useLastShown } from "@/lib/useLastShown";
import type { useSessionPullRequest } from "@/lib/useSessionPullRequest";

const states = {
  open: { Icon: GitPullRequestIcon, color: "text-ok", variant: "success" },
  draft: { Icon: GitPullRequestDraftIcon, color: "text-muted-foreground", variant: "secondary" },
  merged: { Icon: GitMergeIcon, color: "text-merged", variant: "merged" },
  closed: { Icon: GitPullRequestClosedIcon, color: "text-err", variant: "error" },
} as const;

const signalIcons: Record<SignalOutcome, { Icon: LucideIcon; color: string }> = {
  pending: { Icon: ClockIcon, color: "text-muted-foreground" },
  success: { Icon: CheckIcon, color: "text-ok" },
  failure: { Icon: XCircleIcon, color: "text-err" },
  approved: { Icon: CheckIcon, color: "text-ok" },
  changes_requested: { Icon: MessageSquareIcon, color: "text-err" },
  review_required: { Icon: MessageSquareIcon, color: "text-muted-foreground" },
};

/** One associated PR, not transcript references or a decorative link stack. */
function SessionPullRequestTrigger({
  view,
  ref,
}: {
  view: PullRequestView;
  ref: React.Ref<HTMLButtonElement>;
}) {
  const mobile = useIsMobile();
  const { status } = view;
  const face = pullRequestTrigger(view);
  const Icon = status ? states[status.state].Icon : GitPullRequestIcon;
  return (
    <Tooltip>
      <PopoverTrigger asChild>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            variant="ghost"
            size={mobile ? "xs" : "lg"}
            aria-label={face.ariaLabel}
            aria-description={face.ariaDescription}
          >
            <Icon
              data-icon="inline-start"
              className={status ? states[status.state].color : "text-muted-foreground"}
              aria-hidden
            />{" "}
            {face.label}
          </Button>
        </TooltipTrigger>
      </PopoverTrigger>
      <TooltipContent className="max-w-80">
        <p className="text-wrap">{face.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Size of the change, as GitHub's PR header puts it: files changed, then lines added and removed. */
function DiffStat({ diff }: { diff: NonNullable<PullRequestView["diff"]> }) {
  const { additions, deletions, changedFiles } = diff;
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
function PullRequestFacts({ view }: { view: PullRequestView }) {
  const { branches, diff, signals } = view;
  if (!branches && !diff && !signals.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {branches && (
        <div
          className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground"
          title={`${branches.head} into ${branches.base}`}
        >
          <GitBranchIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{branches.head}</span>
          <ArrowRightIcon className="size-3 shrink-0" aria-label="into" />
          <span className="shrink-0">{branches.base}</span>
        </div>
      )}
      {diff && <DiffStat diff={diff} />}
      {signals.length > 0 && (
        // Plain supporting facts, rather than competing status badges; only the icon carries the outcome color.
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {signals.map((signal) => {
            const { Icon, color } = signalIcons[signal.outcome];
            return (
              <span key={signal.label} className="flex items-center gap-1.5">
                <Icon className={`size-3 shrink-0 ${color}`} aria-hidden />
                {signal.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PullRequestStatusBadge({ status }: { status: NonNullable<PullRequestView["status"]> }) {
  const { Icon, variant } = states[status.state];
  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" aria-hidden />
      {status.label}
    </Badge>
  );
}

type PullRequestControl = ReturnType<typeof useSessionPullRequest>;

/** Renders the surface `pr` decides on and moves focus between its controls. */
export function SessionPullRequestControl({
  pr,
  menuTrigger,
}: {
  pr: PullRequestControl;
  /** The session menu, which opens this control while no PR is linked. */
  menuTrigger: React.RefObject<HTMLButtonElement | null>;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const link = pr.value?.link;
  const view = pullRequestView(pr.value);
  const popoverOpen = pr.surface === "details" || pr.surface === "editing";
  // The popover animates closed after its surface closes, so it keeps the last face meanwhile.
  const face = useLastShown(popoverOpen ? { surface: pr.surface, value: pr.value } : undefined);
  const faceView = pullRequestView(face?.value);
  const faceSurface = face?.surface;
  const showingDetails = !!faceView && faceSurface === "details";
  // Opening, cancel and successful discovery replace the focused form controls.
  useEffect(() => {
    if (showingDetails) closeRef.current?.focus();
  }, [showingDetails]);
  const onOpenChange = (open: boolean) => (open ? pr.open() : pr.close());
  // Closing returns to whichever control can reopen this: the PR button once linked, else the menu.
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    (link ? triggerRef : menuTrigger).current?.focus();
  };
  return (
    <>
      <Dialog open={pr.surface === "link-form"} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-sm"
          aria-describedby={undefined}
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader>
            <DialogTitle>Pull request</DialogTitle>
          </DialogHeader>
          <PullRequestForm pr={pr} editing={false} />
        </DialogContent>
      </Dialog>
      <Popover open={popoverOpen} onOpenChange={onOpenChange}>
        {view && <SessionPullRequestTrigger view={view} ref={triggerRef} />}
        <PopoverContent
          onCloseAutoFocus={restoreFocus}
          align="start"
          sideOffset={8}
          collisionPadding={16}
          aria-labelledby={titleId}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto"
        >
          <PopoverHeader className="flex-row items-center justify-between gap-2">
            {faceView && showingDetails ? (
              <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <BookMarkedIcon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-all">
                  {faceView.repo}{" "}
                  {faceView.number && (
                    <span className="whitespace-nowrap">· #{faceView.number}</span>
                  )}
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
              onClick={pr.close}
            >
              <XIcon />
            </Button>
          </PopoverHeader>
          {faceView && showingDetails ? (
            <>
              {/* Plain PR facts, not a second card inside the popover. */}
              <div className="flex min-w-0 flex-col gap-2">
                <PopoverTitle id={titleId}>
                  <a
                    href={faceView.url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-words hover:underline"
                  >
                    {faceView.title ?? "View pull request"}
                  </a>
                </PopoverTitle>
                {/* Status, then provenance, each on its own line: the card never reflows as the time label grows. */}
                <div className="flex flex-col items-start gap-3">
                  {faceView.status ? (
                    <PullRequestStatusBadge status={faceView.status} />
                  ) : (
                    <Badge variant="secondary">{STATUS_UNAVAILABLE}</Badge>
                  )}
                  {(faceView.author || faceView.timeLabel) && (
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {faceView.author && (
                        <>
                          <Avatar size="sm" className="size-4" aria-hidden>
                            <AvatarImage
                              src={`https://github.com/${faceView.author}.png?size=40`}
                              alt=""
                            />
                            <AvatarFallback>
                              {faceView.author.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-foreground">{faceView.author}</span>
                        </>
                      )}
                      {faceView.timeLabel && <span className="shrink-0">{faceView.timeLabel}</span>}
                    </span>
                  )}
                </div>
              </div>
              <PullRequestFacts view={faceView} />
              <Separator className="opacity-50" />
              {/* Pull the ghost buttons' padding out so their labels meet the content edge. */}
              <div className="-mr-2 -mb-1 flex justify-end gap-1">
                <Button variant="ghost" size="xs" disabled={pr.busy} onClick={pr.edit}>
                  Change link
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={pr.busy}
                  onClick={() => {
                    void pr.remove();
                  }}
                >
                  Remove link
                </Button>
              </div>
            </>
          ) : (
            <PullRequestForm pr={pr} editing={faceSurface === "editing"} />
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

/** Mount a draft only when editing; background refreshes must not replace typed input. */
function PullRequestForm({ pr, editing }: { pr: PullRequestControl; editing: boolean }) {
  const [url, setUrl] = useState(pr.value?.link?.url ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const form = pullRequestForm({ url, busy: pr.busy, finding: pr.finding, editing });
  const { secondary } = form;
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (form.canSubmit) await pr.link(url);
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
        <Button type="submit" disabled={!form.canSubmit}>
          {form.submitLabel}
        </Button>
        {secondary.action === "cancel" ? (
          <Button type="button" variant="ghost" onClick={pr.cancel}>
            {secondary.label}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={secondary.disabled}
            onClick={() => {
              void pr.discover();
            }}
          >
            <GitBranchIcon data-icon="inline-start" />
            {secondary.label}
          </Button>
        )}
      </div>
    </form>
  );
}
