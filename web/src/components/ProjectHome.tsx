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
import { StatusDot } from "@/components/StatusDot";
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
import { projectHome, stableOrder } from "@/lib/projectHome";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, sessionKey } from "@/store";

/** Rows keep their place while the page is open: a new key appends, a gone one drops. */
function useStableOrder(keys: readonly string[]): string[] {
  const order = useRef<string[]>([]);
  order.current = stableOrder(order.current, keys);
  return order.current;
}

/**
 * The home's geometry while the registry loads, like the sidebar's skeleton: hidden from screen
 * readers and late to appear, so a quick load shows the home without it and nothing is announced.
 */
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

/**
 * A project's home: its member sessions, newest activity first, each with its title, folder,
 * branch, saved pull request name and last activity. Everything comes from the session catalog the browser already holds.
 */
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
            commands={projectCommands(state, project)}
            run={run}
            size="header"
            trailing
          />
        }
      >
        {/* The way up, as the session header's crumb is: Projects, then the home's name as the title. */}
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
              {/* The home's one statement of the project's state; the index says it by grouping. */}
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
          {/* A session started here joins this project. */}
          <NewSessionComposer state={state} client={client} chooseDirectory={chooseDirectory} />
          {/* The sessions as one titled group, as a Settings page lists things: the count beside
           * the name, and the empty line alone when it would be zero, so the fact is said once. */}
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
                      // Dim as the sidebar row does: a missing checkout, or a session with no title yet.
                      className: cn("disabled:text-ink-3", !s.title && "text-ink-3"),
                    }}
                    value={
                      <time dateTime={s.updatedAt} className="text-xs text-ink-3">
                        {timeAgo(s.updatedAt, now)}
                      </time>
                    }
                    menu={
                      <RowMenu label={`Session menu for ${s.label}`}>
                        <SessionMenu target={s} />
                      </RowMenu>
                    }
                  >
                    <ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs">
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
