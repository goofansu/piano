import { cn } from "cn";
import { type ComponentProps, useRef } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { useCommands } from "@/components/CommandHost";
import { NewSessionComposer } from "@/components/NewSession";
import { PaneBody, PaneHeader, PaneNotFound } from "@/components/Pane";
import { ProjectCommandsMenu } from "@/components/Projects";
import { SettingsGroup, SettingsList, settingsRow } from "@/components/SettingsSectionFrame";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { projectCommands } from "@/lib/projectCommands";
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
 * branch, saved pull request number and last activity. Everything comes from the session catalog the browser already holds.
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
            <BreadcrumbItem className="min-w-0">
              <h1 aria-current="page" className="min-w-0 truncate text-sm font-medium text-ink">
                {project.name}
              </h1>
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
                  <EmptyDescription>No sessions yet</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <SettingsList className="bg-surface-1">
                {sessions.map((s) => (
                  <Item
                    key={sessionKey(s)}
                    asChild
                    role="listitem"
                    className={cn(settingsRow, "text-left hover:bg-fill-hover")}
                  >
                    <button
                      type="button"
                      disabled={s.disabled}
                      title={s.hint}
                      onClick={() => select(s.cwd, s.sessionId)}
                    >
                      <ItemContent className="min-w-0 gap-0.5">
                        <ItemTitle className="w-full min-w-0">
                          <span className="min-w-0 flex-1 truncate">{s.label}</span>
                        </ItemTitle>
                        <ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs">
                          {/* The folder keeps its name (up to half the line); a long branch truncates first. */}
                          <span className="max-w-1/2 shrink-0 truncate">{s.folder}</span>
                          {s.branch && <BranchLabel branch={s.branch} />}
                          {s.pullRequest && <span className="shrink-0">#{s.pullRequest}</span>}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="self-start text-xs text-ink-3">
                        <time dateTime={s.updatedAt}>{timeAgo(s.updatedAt, now)}</time>
                      </ItemActions>
                    </button>
                  </Item>
                ))}
              </SettingsList>
            )}
          </SettingsGroup>
        </div>
      </PaneBody>
    </>
  );
}
