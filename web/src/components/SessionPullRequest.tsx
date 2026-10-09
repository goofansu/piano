import type { PullRequest, SessionPullRequest } from "@shared/wire";
import { BookMarkedIcon, CheckIcon, ClockIcon, GitBranchIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, MessageSquareIcon, XCircleIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import type { useSessionPullRequest } from "@/lib/useSessionPullRequest";

const states = {
  open: { label: "Open", Icon: GitPullRequestIcon, color: "text-ok", variant: "success" },
  draft: { label: "Draft", Icon: GitPullRequestDraftIcon, color: "text-muted-foreground", variant: "secondary" },
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
  return <Tooltip>
    <PopoverTrigger asChild>
      <TooltipTrigger asChild>
        <Button variant="ghost" size={mobile ? "xs" : "lg"} aria-label={number ? `Pull request #${number}` : "PR"} aria-description={number ? status?.label ?? "Status unavailable" : undefined}>
          <Icon data-icon="inline-start" className={status?.color ?? "text-muted-foreground"} aria-hidden /> {number ? `#${number}` : "PR"}
        </Button>
      </TooltipTrigger>
    </PopoverTrigger>
    <TooltipContent className="max-w-80">
      <p className="text-wrap">{pr?.title ?? (value?.link ? "View pull request" : "Link pull request")}</p>
    </TooltipContent>
  </Tooltip>;
}

/** Checks and reviews matter while work is open, not after its final disposition. */
function PullRequestSignals({ pr }: { pr: PullRequest }) {
  if (pr.state !== "open" && pr.state !== "draft") return null;
  const checks = {
    none: null,
    pending: { label: "Checks running", Icon: ClockIcon },
    success: { label: "Checks passed", Icon: CheckIcon },
    failure: { label: "Checks failed", Icon: XCircleIcon },
  }[pr.checks];
  const review = {
    none: null,
    approved: { label: "Approved", Icon: CheckIcon },
    changes_requested: { label: "Changes requested", Icon: MessageSquareIcon },
    review_required: { label: "Review required", Icon: MessageSquareIcon },
  }[pr.review];
  if (!checks && !review) return null;
  // Plain supporting facts, rather than competing status badges.
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
    {[checks, review].map(signal => signal && <span key={signal.label} className="flex items-center gap-1">
      <signal.Icon className="size-3 shrink-0" aria-hidden />{signal.label}
    </span>)}
  </div>;
}

type PullRequestControl = ReturnType<typeof useSessionPullRequest>;

export function SessionPullRequestControl({ open, onOpenChange, pr }: {
  open: boolean; onOpenChange: (open: boolean) => void; pr: PullRequestControl;
}) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const link = pr.value?.link;
  const pullRequest = pr.value?.pullRequest;
  const showingDetails = !!link && !editing;
  const status = pullRequest ? states[pullRequest.state] : undefined;
  const repo = pullRequest?.repo ?? (link ? new URL(link.url).pathname.split("/").slice(1, 3).join("/") : "");
  const number = pullRequest?.number ?? link?.url.split("/").pop();
  useEffect(() => {
    if (!open) { setEditing(false); setLinking(false); }
    else if (!link) setLinking(true);
  }, [open]);
  // A discovered or manually linked PR reveals the header, not a second overlay.
  useEffect(() => { if (open && linking && link) onOpenChange(false); }, [open, linking, link]);
  // Cancel and successful discovery replace the focused form controls.
  useEffect(() => { if (open && showingDetails) closeRef.current?.focus(); }, [open, showingDetails]);
  // Opening may refresh an existing link, but must not discover or associate one.
  useEffect(() => { if (open && link) void pr.refresh(); }, [open]);
  const close = () => onOpenChange(false);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const selector = pr.value?.link ? 'header [data-slot="popover-trigger"]' : 'header [aria-label="Session information and actions"]';
    document.querySelector<HTMLButtonElement>(selector)?.focus();
  };
  return <>
    <Dialog open={open && (!link || linking)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined} onCloseAutoFocus={restoreFocus}>
        <DialogHeader><DialogTitle>Link pull request</DialogTitle></DialogHeader>
        <PullRequestForm pr={pr} editing={false} onCancel={close} onSave={close} />
      </DialogContent>
    </Dialog>
    <Popover open={open && !!link && !linking} onOpenChange={onOpenChange}>
      {link && <SessionPullRequestTrigger value={pr.value} />}
      <PopoverContent onCloseAutoFocus={restoreFocus} align="start" sideOffset={8} collisionPadding={16} aria-labelledby={titleId} className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto">
        <PopoverHeader className="flex-row items-center justify-between gap-2">
          {showingDetails ? <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <BookMarkedIcon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-all">{repo}</span>
          </p> : <PopoverTitle id={titleId}>{editing ? "Change pull request" : "Link pull request"}</PopoverTitle>}
          <Button ref={closeRef} variant="ghost" size="icon-xs" aria-label="Close pull request" onClick={close}><XIcon /></Button>
        </PopoverHeader>
        {link && showingDetails ? <>
          {/* Plain PR facts, not a second card inside the popover. */}
          <div className="flex min-w-0 flex-col gap-3">
            <PopoverTitle id={titleId}>
              <a href={link.url} target="_blank" rel="noreferrer" className="break-words hover:underline">{pullRequest?.title ?? "View pull request"}</a>
            </PopoverTitle>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">#{number}</span>
              {status ? <Badge variant={status.variant}><status.Icon data-icon="inline-start" aria-hidden />{status.label}</Badge>
                : <Badge variant="secondary">Status unavailable</Badge>}
            </div>
            {pullRequest && <PullRequestSignals pr={pullRequest} />}
          </div>
          <Separator />
          <div className="flex justify-between gap-2">
            <Button variant="ghost" size="sm" disabled={pr.busy} onClick={() => setEditing(true)}>Change link</Button>
            <Button variant="ghost" size="sm" disabled={pr.busy} onClick={async () => { if (await pr.change({ action: "remove" })) close(); }}>Remove link</Button>
          </div>
        </> : <PullRequestForm pr={pr} editing={editing} onCancel={() => link ? setEditing(false) : close()} onSave={close} />}
      </PopoverContent>
    </Popover>
  </>;
}

/** Mount a draft only when editing; background refreshes must not replace typed input. */
function PullRequestForm({ pr, editing, onCancel, onSave }: {
  pr: PullRequestControl; editing: boolean; onCancel: () => void; onSave: () => void;
}) {
  const [url, setUrl] = useState(pr.value?.link?.url ?? "");
  const [finding, setFinding] = useState(false);
  const find = async () => {
    setFinding(true);
    try {
      const result = await pr.change({ action: "discover" });
      // Only the explicit search reports absence; polling stays silent.
      if (result && result.link) onSave();
      else if (result && !result.error) toast("No open PR found for this branch.");
    } finally { setFinding(false); }
  };
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  return <form onSubmit={async event => { event.preventDefault(); if (await pr.change({ action: "link", url })) onSave(); }} className="flex flex-col gap-4">
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="session-pr-url" className="sr-only">PR URL</FieldLabel>
        <Input ref={inputRef} id="session-pr-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/…" />
      </Field>
    </FieldGroup>
    <div className="flex flex-col gap-2">
      <Button type="submit" disabled={pr.busy || finding || !url.trim()}>{editing ? "Save link" : "Link"}</Button>
      {editing ? <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        : <Button type="button" variant="outline" disabled={pr.busy || finding} onClick={() => { void find(); }}><GitBranchIcon data-icon="inline-start" />{finding ? "Finding…" : "Find from branch"}</Button>}
    </div>
  </form>;
}
