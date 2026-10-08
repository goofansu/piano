import { useEffect, useState } from "react";
import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from "lucide-react";
import type { PullRequest, SessionPullRequest } from "@shared/wire";
import type { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
export function SessionPullRequestBadge({ value }: { value: SessionPullRequest | undefined }) {
  if (!value?.link) return null;
  const pr = value.pullRequest;
  const status = pr ? states[pr.state] : undefined;
  const Icon = status?.Icon ?? GitPullRequestIcon;
  const summary = pr ? details(pr, false) : "Status unavailable";
  const number = pr?.number ?? value.link.url.split("/").pop();
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button asChild variant="ghost" size="sm">
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

export function SessionPullRequestDialog({ open, onOpenChange, pr }: {
  open: boolean; onOpenChange: (open: boolean) => void; pr: ReturnType<typeof useSessionPullRequest>;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (open) setUrl(pr.value?.link?.url ?? ""); }, [open, pr.value?.link?.url]);
  // Opening details is also an explicit retry; polling failures stay out of the main view.
  useEffect(() => { if (open) void pr.refresh(); }, [open]);
  const submit = async () => { if (await pr.change({ action: "link", url })) onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Pull request</DialogTitle>
        <DialogDescription>Link this session’s work, or find an open pull request for its current branch.</DialogDescription>
      </DialogHeader>
      {pr.value?.pullRequest && <div className="flex flex-col gap-1 text-sm">
        <p className="break-words">{pr.value.pullRequest.title}</p>
        <p className="text-muted-foreground">{details(pr.value.pullRequest)}</p>
      </div>}
      <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="session-pr-url">GitHub pull request URL</FieldLabel>
            <Input id="session-pr-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/owner/repo/pull/123" disabled={pr.busy} />
            {pr.value?.error && <FieldError>{pr.value.error}</FieldError>}
            {!pr.busy && pr.value && !pr.value.error && !pr.value.link && <p role="status" className="text-sm text-muted-foreground">
              {pr.value.discovery ? "No matching open pull request." : "No pull request linked. Automatic discovery is off."}
            </p>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pr.busy} onClick={() => { void pr.change({ action: "discover" }); }}>Find from branch</Button>
          {pr.value?.link && <Button type="button" variant="outline" disabled={pr.busy} onClick={async () => {
            if (await pr.change({ action: "remove" })) onOpenChange(false);
          }}>Remove link</Button>}
          <Button type="submit" disabled={pr.busy || !url.trim()}>Link pull request</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
