import { PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { BranchLabel } from "@/components/BranchLabel";
import { useCommands } from "@/components/CommandHost";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { sessionPullRequest } from "@/lib/api";
import { projectCommand } from "@/lib/projectCommands";
import {
  type ProjectHomeSession,
  projectHome,
  pullRequestTargets,
  stableOrder,
} from "@/lib/projectHome";
import {
  createProjectPullRequests,
  type PullRequestState,
  type PullRequestTarget,
} from "@/lib/projectPullRequests";
import type { SessionActivity } from "@/lib/sessionCatalog";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

const ACTIVITY: Record<SessionActivity, string | undefined> = {
  working: "Running",
  done: "Settled",
  idle: "Idle",
  off: undefined,
};

const PR_BADGES = {
  open: { label: "Open", variant: "success" },
  draft: { label: "Draft", variant: "secondary" },
  merged: { label: "Merged", variant: "merged" },
  closed: { label: "Closed", variant: "error" },
  unavailable: { label: undefined, variant: "outline" },
} as const;

/** Rows keep their place while the page is open: a new key appends, a gone one drops. */
function useStableOrder(keys: readonly string[]): string[] {
  const order = useRef<string[]>([]);
  order.current = stableOrder(order.current, keys);
  return order.current;
}

/** Linked pull requests' states, read in the background for this page view only. */
function usePullRequestStates(targets: readonly PullRequestTarget[]) {
  const [reads] = useState(() => createProjectPullRequests({ read: sessionPullRequest }));
  useEffect(() => reads.start(), [reads]);
  // `want` skips links already read or queued, so each render may hand it every target.
  useEffect(() => reads.want(targets));
  return useSyncExternalStore(reads.subscribe, reads.getState);
}

function PullRequestBadge({ url, state }: { url: string; state: PullRequestState | undefined }) {
  const number = url.split("/").pop();
  const badge = state ? PR_BADGES[state] : undefined;
  return (
    <StatusBadge variant={badge?.variant ?? "outline"}>
      #{number}
      {badge?.label && ` ${badge.label}`}
    </StatusBadge>
  );
}

function Activity({ activity }: { activity: SessionActivity }) {
  const label = ACTIVITY[activity];
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-2">
      <ActivityGlyph activity={activity} />
      {label && <span className="max-md:sr-only">{label}</span>}
    </span>
  );
}

/**
 * A project's home: the branches its sessions run on, each shown by its latest session, then the
 * members on a folder's own checkout. Everything but a linked pull request's state is already in
 * the browser, so the page draws at once; those states fill in as GitHub answers.
 */
export function ProjectHome({ state, projectId }: { state: AppState; projectId: string }) {
  const { select, openNew } = useNavigation();
  const { run } = useCommands();
  const home = projectHome(state, projectId);
  const branchOrder = useStableOrder(home?.branches.map((b) => b.key) ?? []);
  const otherOrder = useStableOrder(home?.others.map((o) => o.entry.sessionId) ?? []);
  const prs = usePullRequestStates(home ? pullRequestTargets(home) : []);

  if (!home)
    return (
      <>
        <ShowSidebarButton className="absolute top-2 left-2" />
        <Empty className="flex-1 px-4" role="alert">
          <EmptyHeader>
            <EmptyTitle>Project not found</EmptyTitle>
            <EmptyDescription>This project is not in Piano's database.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );

  const { project } = home;
  const create = projectCommand(state, project, "new-session");
  const unarchive = projectCommand(state, project, "unarchive");
  const branches = branchOrder.flatMap((key) => home.branches.find((b) => b.key === key) ?? []);
  const others = otherOrder.flatMap(
    (id) => home.others.find((o) => o.entry.sessionId === id) ?? [],
  );
  const open = (member: ProjectHomeSession) => select(member.entry.cwd, member.entry.sessionId);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6 md:py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <div className="flex min-w-0 items-center gap-2">
          <ShowSidebarButton className="-ml-2" />
          <h1 className="min-w-0 flex-1 truncate text-xl font-medium tracking-tight">
            {project.name}
          </h1>
          {create && (
            // On a phone the name keeps the width: the button shows its icon and keeps its name for screen readers.
            <Button
              className="max-md:size-11 max-md:px-0"
              disabled={!create.enabled}
              onClick={() => openNew(undefined, project.id)}
            >
              <PlusIcon data-icon="inline-start" />
              <span className="max-md:sr-only">{create.label}</span>
            </Button>
          )}
        </div>
        {unarchive && (
          <Alert>
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>This project is archived.</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={!unarchive.enabled}
                onClick={() => run(unarchive)}
              >
                {unarchive.label}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {branches.length > 0 && (
          <section aria-labelledby="project-branches" className="flex flex-col gap-2.5">
            <h2 id="project-branches" className="text-sm font-semibold">
              Branches
            </h2>
            <ItemGroup className="gap-2">
              {branches.map((b) => (
                <Item
                  key={b.key}
                  asChild
                  role="listitem"
                  variant="outline"
                  size="sm"
                  className="flex-nowrap bg-surface-1 text-left hover:bg-fill-hover"
                >
                  <button type="button" onClick={() => open(b.latest)}>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="min-w-0">
                        <BranchLabel branch={b.branch} />
                      </ItemTitle>
                      <ItemDescription className="truncate">
                        {b.folder} · {b.latest.entry.title || "Untitled"}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {b.pullRequest?.link && (
                        <PullRequestBadge
                          url={b.pullRequest.link.url}
                          state={prs.get(b.pullRequest.link.url)}
                        />
                      )}
                      <Activity activity={b.latest.entry.activity} />
                    </ItemActions>
                  </button>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )}
        {others.length > 0 && (
          <section aria-labelledby="project-others" className="flex flex-col gap-2.5">
            <h2 id="project-others" className="text-sm font-semibold">
              Other sessions
            </h2>
            <ItemGroup className="gap-2">
              {others.map((o) => (
                <Item
                  key={o.entry.sessionId}
                  asChild
                  role="listitem"
                  variant="outline"
                  size="sm"
                  className="flex-nowrap bg-surface-1 text-left hover:bg-fill-hover"
                >
                  <button type="button" disabled={o.entry.disabled} onClick={() => open(o)}>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="min-w-0 truncate">
                        {o.entry.title || "Untitled"}
                      </ItemTitle>
                      <ItemDescription className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{o.entry.folder}</span>
                        {o.entry.branch && <BranchLabel branch={o.entry.branch} />}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Activity activity={o.entry.activity} />
                    </ItemActions>
                  </button>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )}
      </div>
    </div>
  );
}
