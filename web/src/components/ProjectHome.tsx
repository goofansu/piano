import { cn } from "cn";
import { GitPullRequestIcon, MessagesSquareIcon } from "lucide-react";
import { type ComponentProps, useRef } from "react";
import { useCommands } from "@/components/CommandHost";
import { NewSessionComposer } from "@/components/NewSession";
import { PaneBody, PaneHeader, PaneNotFound } from "@/components/Pane";
import { ProjectCommandsMenu } from "@/components/Projects";
import { ListRow, RowMenu } from "@/components/RowActions";
import { SessionDetails } from "@/components/SessionDetails";
import { SettingsGroup, SettingsList } from "@/components/SettingsSectionFrame";
import { SessionMenu } from "@/components/SidebarSessionList";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ItemDescription } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { isProjectDone, projectCommands } from "@/lib/projectCommands";
import { type ProjectHomeCue, projectHome, stableOrder } from "@/lib/projectHome";
import { useOffers } from "@/lib/useMachine";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, sessionKey } from "@/store";

function useStableOrder(keys: readonly string[]): string[] {
  const order = useRef<string[]>([]);
  order.current = stableOrder(order.current, keys);
  return order.current;
}

const activityCues = {
  working: { tone: "busy", label: "Working" },
  idle: { tone: "ok", label: "Idle" },
  done: { tone: "done", label: "Finished" },
} as const satisfies Record<ProjectHomeCue, { tone: StatusTone; label: string }>;

function ActivityCue({ activity }: { activity: ProjectHomeCue | null }) {
  if (!activity) return null;
  const { tone, label } = activityCues[activity];
  return (
    <span
      data-activity={activity}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5",
        activity === "working" && "font-medium text-ink",
      )}
    >
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

function ProjectHomeSkeleton() {
  return (
    <>
      <PaneHeader>
        <div aria-hidden className="late-enter flex min-w-0 flex-1 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
      </PaneHeader>
      <PaneBody>
        <div aria-hidden className="late-enter mx-auto flex w-full max-w-3xl flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </PaneBody>
    </>
  );
}

export function ProjectHome({
  state,
  client,
  chooseDirectory,
  projectId,
}: {
  state: AppState;
  client: ComponentProps<typeof NewSessionComposer>["client"];
  chooseDirectory: (cwd: string) => void;
  projectId: string;
}) {
  const { select, openProjects } = useNavigation();
  const { run } = useCommands();
  const offers = useOffers();
  const home = projectHome(state, projectId);
  const order = useStableOrder(home.kind === "home" ? home.sessions.map(sessionKey) : []);

  if (home.kind === "loading") return <ProjectHomeSkeleton />;
  if (home.kind === "missing")
    return (
      <PaneNotFound
        title="Project not found"
        description="This project is not in Piano's database."
        action={
          <Button variant="outline" onClick={() => openProjects()}>
            Projects
          </Button>
        }
      />
    );

  const { project } = home;
  const byKey = new Map(home.sessions.map((s) => [sessionKey(s), s]));
  const sessions = order.flatMap((key) => byKey.get(key) ?? []);
  const now = Date.now();

  return (
    <>
      <PaneHeader
        actions={
          <ProjectCommandsMenu
            project={project}
            commands={projectCommands(state, project, offers)}
            run={run}
            size="header"
            trailing
          />
        }
      >
        <Breadcrumb className="flex min-w-0 flex-1 items-center">
          <BreadcrumbList className="min-w-0 flex-nowrap gap-1.5 sm:gap-1.5">
            <BreadcrumbItem className="shrink-0">
              <BreadcrumbLink asChild>
                <button
                  type="button"
                  className="rounded-sm text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openProjects()}
                >
                  Projects
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-ink-3/60">/</BreadcrumbSeparator>
            <BreadcrumbItem className="min-w-0 gap-2">
              <h1 aria-current="page" className="min-w-0 truncate text-sm font-medium text-ink">
                {project.name}
              </h1>
              {isProjectDone(project) && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-3">
                  <StatusDot tone="done" />
                  Done
                </span>
              )}
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PaneHeader>
      <PaneBody>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <NewSessionComposer state={state} client={client} chooseDirectory={chooseDirectory} />
          <SettingsGroup
            id="project-sessions"
            title={
              <>
                Sessions
                {sessions.length > 0 && (
                  <span className="font-normal text-ink-3 tabular-nums">{sessions.length}</span>
                )}
              </>
            }
          >
            {sessions.length === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessagesSquareIcon aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>No sessions yet</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <SettingsList>
                {sessions.map((s) => (
                  <ListRow
                    key={sessionKey(s)}
                    title={s.label}
                    open={{
                      onOpen: () => select(s.cwd, s.sessionId),
                      disabled: s.disabled,
                      hint: s.hint,
                      className: cn("disabled:text-ink-3", !s.title && "text-ink-3"),
                    }}
                    time={{ at: s.updatedAt, text: timeAgo(s.updatedAt, now) }}
                    menu={
                      <RowMenu label={`Session menu for ${s.label}`}>
                        <SessionMenu target={s} />
                      </RowMenu>
                    }
                  >
                    <ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs">
                      <ActivityCue activity={s.cue} />
                      <SessionDetails folder={s.folder} branch={s.branch} />
                      {s.pullRequest && (
                        <span className="inline-flex shrink-0 items-center gap-1">
                          <GitPullRequestIcon className="size-3 shrink-0" aria-hidden />
                          <span className="sr-only">Pull request </span>
                          {s.pullRequest}
                        </span>
                      )}
                    </ItemDescription>
                  </ListRow>
                ))}
              </SettingsList>
            )}
          </SettingsGroup>
        </div>
      </PaneBody>
    </>
  );
}
