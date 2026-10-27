import type { LocalWork } from "@shared/wire";
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  type LucideIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/PianoDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { StatusBadge as Badge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { returnFocusForKeyboard } from "@/lib/pointerClose";
import {
  type PullRequestView,
  pullRequestForm,
  pullRequestRow,
  pullRequestView,
  type SignalOutcome,
} from "@/lib/pullRequestView";
import type { useSessionPullRequest } from "@/lib/useSessionPullRequest";

/** Each state's icon and colour, GitHub's: green open, grey draft, purple merged, red closed. */
export const pullRequestStates = {
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

export type PullRequestControl = ReturnType<typeof useSessionPullRequest>;

/** The linked pull request as the control knows it: named from the registry's link at once. */
export function pullRequestViewOf(pr: PullRequestControl): PullRequestView | undefined {
  return pullRequestView(
    pr.value ?? (pr.registered ? { link: pr.registered, pullRequest: null } : undefined),
  );
}

/**
 * The pull request row under the Changes toolbar, only while the registry links one: the number
 * and title (the link to GitHub), its state, checks and review, what is still only local, and its
 * branches when its head is not the branch Changes inspects. Its menu holds the link's actions.
 * Hand-written: a one-line fact row with an actions menu has no shadcn component.
 */
export function PullRequestRow({
  pr,
  branch,
  local,
}: {
  pr: PullRequestControl;
  /** The branch Changes inspects. */
  branch: string | undefined;
  local: LocalWork | undefined;
}) {
  const view = pullRequestViewOf(pr);
  if (!pr.linked || !view) return null;
  const row = pullRequestRow(view, { branch, local, loading: pr.loading && !pr.value });
  const state = row.status.state && pullRequestStates[row.status.state];
  const Icon = state?.Icon ?? GitPullRequestIcon;
  return (
    <section
      aria-label="Pull request"
      className="flex min-w-0 items-center gap-x-3 border-b border-line py-1 pr-2 pl-4 text-xs text-ink-2"
    >
      <Icon
        data-motion={pr.loading && !pr.value ? "pulse" : undefined}
        className={`size-3.5 shrink-0 ${state?.color ?? "text-muted-foreground"}`}
        aria-hidden
      />
      {/* One wrapping line: the link, then each fact whole; a narrow row flows them beneath. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex max-w-full min-w-0 items-center gap-1 text-ink underline-offset-4 hover:underline"
        >
          <span className="shrink-0">{row.name}</span>
          {row.title && <span className="truncate">{row.title}</span>}
          <ExternalLinkIcon className="size-3 shrink-0 text-ink-3" aria-hidden />
        </a>
        {state ? (
          <Badge variant={state.variant}>{row.status.label}</Badge>
        ) : (
          <Badge variant="secondary">{row.status.label}</Badge>
        )}
        {row.signals.map((signal) => {
          const { Icon: SignalIcon, color } = signalIcons[signal.outcome];
          return (
            <span
              key={signal.label}
              className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground"
            >
              <SignalIcon className={`size-3 shrink-0 ${color}`} aria-hidden />
              {signal.label}
            </span>
          );
        })}
        {row.local.map((fact) => (
          <span key={fact} className="whitespace-nowrap text-muted-foreground">
            {fact}
          </span>
        ))}
        {row.branches && (
          <span
            className="flex max-w-full min-w-0 items-center gap-1 font-mono text-muted-foreground"
            title={`${row.branches.head} into ${row.branches.base}`}
          >
            <GitBranchIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{row.branches.head}</span>
            <ArrowRightIcon className="size-3 shrink-0" aria-label="into" />
            <span className="shrink-0">{row.branches.base}</span>
          </span>
        )}
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton size="list" label="Pull request actions" disabled={pr.busy}>
            <MoreHorizontalIcon />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={row.url} target="_blank" rel="noopener noreferrer">
              Open pull request <ExternalLinkIcon data-icon="inline-end" aria-hidden />
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={pr.open}>Change link…</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void pr.discover().then((outcome) => {
                if (outcome._tag === "saved" && outcome.value.link)
                  toast.success("Pull request linked");
              });
            }}
          >
            Find from branch
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void pr.remove().then((outcome) => {
                if (outcome._tag === "saved") toast.success("Pull request link removed");
              });
            }}
          >
            Remove link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </section>
  );
}

/**
 * The link dialog: linking a pull request to a session without one (with Find from branch), or
 * changing the saved link. Opened from the session menu, the palette and the row's menu; a link
 * that appears closes it.
 */
export function PullRequestLinkDialog({
  pr,
  menuTrigger,
}: {
  pr: PullRequestControl;
  /** The session menu, which opens this dialog while no pull request is linked. */
  menuTrigger: React.RefObject<HTMLButtonElement | null>;
}) {
  const editing = pr.surface === "editing";
  const open = editing || pr.surface === "link-form";
  // A keyboard close returns focus to the menu that can reopen this; a pointer close leaves focus
  // where the click put it.
  const restoreFocus = (event: Event) => {
    returnFocusForKeyboard(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    menuTrigger.current?.focus();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && pr.cancel()}>
      <DialogContent
        className="sm:max-w-sm"
        aria-describedby={undefined}
        onCloseAutoFocus={restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>{editing ? "Change link" : "Pull request"}</DialogTitle>
        </DialogHeader>
        {open && <PullRequestForm pr={pr} editing={editing} />}
      </DialogContent>
    </Dialog>
  );
}

/** Mount a draft only while open; background refreshes must not replace typed input. */
function PullRequestForm({ pr, editing }: { pr: PullRequestControl; editing: boolean }) {
  const [url, setUrl] = useState(pr.value?.link?.url ?? pr.registered?.url ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const form = pullRequestForm({ url, busy: pr.busy, finding: pr.finding, editing });
  const { secondary } = form;
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!form.canSubmit) return;
        const outcome = await pr.link(url);
        if (outcome._tag === "saved") toast.success("Pull request linked");
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
              void pr.discover().then((outcome) => {
                if (outcome._tag === "saved" && outcome.value.link)
                  toast.success("Pull request linked");
              });
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
