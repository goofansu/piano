import type { PullRequest, SessionPullRequest } from "@shared/wire";
import { ChevronDownIcon, ExternalLinkIcon, GitBranchIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { useSessionPullRequest } from "@/lib/useSessionPullRequest";

const states = {
  open: { label: "Open", Icon: GitPullRequestIcon, color: "text-ok" },
  draft: { label: "Draft", Icon: GitPullRequestDraftIcon, color: "text-muted-foreground" },
  merged: { label: "Merged", Icon: GitMergeIcon, color: "text-merged" },
  closed: { label: "Closed", Icon: GitPullRequestClosedIcon, color: "text-err" },
};
function details(pr: PullRequest, includeState = true) {
  const checks = { none: "", pending: "Checks running", success: "Checks passed", failure: "Checks failed" }[pr.checks];
  const review = { none: "", approved: "Approved", changes_requested: "Changes requested", review_required: "Review required" }[pr.review];
  return [includeState ? states[pr.state].label : "", ...(["open", "draft"].includes(pr.state) ? [checks, review] : [])].filter(Boolean).join(" · ");
}

/** One associated PR, not transcript references or a decorative link stack. */
function SessionPullRequestBadge({ value }: { value: SessionPullRequest | undefined }) {
  if (!value?.link) return null;
  const pr = value.pullRequest;
  const status = pr ? states[pr.state] : undefined;
  const Icon = status?.Icon ?? GitPullRequestIcon;
  const summary = pr ? details(pr, false) : "Status unavailable";
  const number = pr?.number ?? value.link.url.split("/").pop();
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button asChild variant="ghost" size="xs">
        <a href={value.link.url} target="_blank" rel="noreferrer" aria-label={`Open pull request #${number}`} aria-description={status?.label ?? "Status unavailable"}>
          <Icon data-icon="inline-start" className={status?.color ?? "text-muted-foreground"} aria-hidden /> #{number}
        </a>
      </Button>
    </TooltipTrigger>
    <TooltipContent className="max-w-80">
      <p>{pr ? `${pr.repo}: ${pr.title}` : value.link.url}</p>
      {summary && <p>{summary}</p>}
    </TooltipContent>
  </Tooltip>;
}

type PullRequestControl = ReturnType<typeof useSessionPullRequest>;

export function SessionPullRequestControl({ open, onOpenChange, pr }: {
  open: boolean; onOpenChange: (open: boolean) => void; pr: PullRequestControl;
}) {
  const [editing, setEditing] = useState(false);
  const titleId = useId(), errorId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const link = pr.value?.link;
  const pullRequest = pr.value?.pullRequest;
  const showingDetails = !!link && !editing;
  useEffect(() => { if (!open) setEditing(false); }, [open]);
  // Cancel and successful discovery replace the focused form controls.
  useEffect(() => { if (open && showingDetails) closeRef.current?.focus(); }, [open, showingDetails]);
  // Opening may refresh an existing link, but must not discover or associate one.
  useEffect(() => { if (open && link) void pr.refresh(); }, [open]);
  const close = () => onOpenChange(false);
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverAnchor asChild>
      <ButtonGroup aria-label="Pull request" className="shrink-0">
        {link && <><SessionPullRequestBadge value={pr.value} /><ButtonGroupSeparator /></>}
        <PopoverTrigger asChild>
          <Button variant="ghost" size={link ? "icon-xs" : "xs"} aria-label={link ? "Pull request" : "PR"}>
            {link ? <ChevronDownIcon /> : <><GitPullRequestIcon data-icon="inline-start" /> PR</>}
          </Button>
        </PopoverTrigger>
      </ButtonGroup>
    </PopoverAnchor>
    <PopoverContent align="start" sideOffset={8} collisionPadding={16} aria-labelledby={titleId} className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto">
      <PopoverHeader className="flex-row items-center justify-between gap-2">
        <PopoverTitle id={titleId}>{editing ? "Change pull request" : "Pull request"}</PopoverTitle>
        <Button ref={closeRef} variant="ghost" size="icon-xs" aria-label="Close pull request" onClick={close}><XIcon /></Button>
      </PopoverHeader>
      {link && showingDetails ? <>
        {/* Plain PR facts, not a second card inside the popover. */}
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          <a href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-muted-foreground hover:underline">
            <span className="min-w-0 break-words">{pullRequest ? `${pullRequest.repo} #${pullRequest.number}` : link.url}</span>
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
          </a>
          {pullRequest && <p className="break-words font-medium">{pullRequest.title}</p>}
          <p className="text-muted-foreground">{pullRequest ? details(pullRequest) : "Status unavailable"}</p>
        </div>
        <Separator />
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={pr.busy} onClick={() => setEditing(true)}>Change link</Button>
          <Button variant="ghost" size="sm" disabled={pr.busy} onClick={async () => { if (await pr.change({ action: "remove" })) close(); }}>Remove link</Button>
        </div>
      </> : <PullRequestForm pr={pr} editing={editing} errorId={errorId} onCancel={() => link ? setEditing(false) : close()} onSave={close} />}
      {pr.value?.error && <div className="flex flex-col items-start gap-2">
        <FieldError id={errorId}>{pr.value.error}</FieldError>
        <Button variant="ghost" size="sm" disabled={pr.busy} onClick={() => { void pr.refresh(); }}>Retry</Button>
      </div>}
    </PopoverContent>
  </Popover>;
}

/** Mount a draft only when editing; background refreshes must not replace typed input. */
function PullRequestForm({ pr, editing, errorId, onCancel, onSave }: {
  pr: PullRequestControl; editing: boolean; errorId: string; onCancel: () => void; onSave: () => void;
}) {
  const [url, setUrl] = useState(pr.value?.link?.url ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  return <form onSubmit={async event => { event.preventDefault(); if (await pr.change({ action: "link", url })) onSave(); }} className="flex flex-col gap-4">
    <FieldGroup>
      {!editing && <>
        <Button type="button" variant="ghost" className="self-start" disabled={pr.busy} onClick={() => { void pr.change({ action: "discover" }); }}><GitBranchIcon data-icon="inline-start" /> Find from branch</Button>
        {!pr.busy && pr.value?.discovery && !pr.value.error && !pr.value.link && <p role="status" className="text-sm text-muted-foreground">No matching open pull request.</p>}
      </>}
      <Field>
        <FieldLabel htmlFor="session-pr-url" className="sr-only">GitHub pull request URL</FieldLabel>
        <InputGroup>
          <InputGroupInput ref={inputRef} id="session-pr-url" value={url} onChange={event => setUrl(event.target.value)} aria-describedby={pr.value?.error ? errorId : undefined} placeholder="Paste GitHub PR URL…" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" disabled={pr.busy || !url.trim()}>{editing ? "Save link" : "Link"}</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </FieldGroup>
    {editing && <Button type="button" variant="ghost" className="self-end" onClick={onCancel}>Cancel</Button>}
  </form>;
}
