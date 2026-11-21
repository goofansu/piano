import { cn } from "cn";
import { ChevronRightIcon, TargetIcon } from "lucide-react";
import { useState } from "react";
import type { AppState } from "@/app/store";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ItemDescription } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommands } from "@/features/commands/CommandHost";
import { PageHeaderActions } from "@/features/commands/PageHeaderActions";
import { projectCommands } from "@/features/projects/projectCommands";
import { ProjectCommandsMenu } from "@/features/projects/Projects";
import {
  type ProjectsIndexRow,
  projectsIndex,
  projectsIndexContext,
} from "@/features/projects/projectsIndexView";
import { SettingsList } from "@/features/settings/SettingsSectionFrame";
import { PaneBody, PaneHeader, PaneHeading } from "@/shared/components/Pane";
import { ListRow } from "@/shared/components/RowActions";
import { timeAgo } from "@/shared/lib/format";
import { isProjectDone } from "../../shared/lib/projects.ts";

function ProjectRow({
  state,
  row,
  time,
  now,
  openProject,
}: {
  state: AppState;
  row: ProjectsIndexRow;
  time: string | undefined;
  now: number;
  openProject: (projectId: string) => void;
}) {
  const { run } = useCommands();
  return (
    <ListRow
      title={row.project.name}
      open={{ onOpen: () => openProject(row.project.id) }}
      time={
        time
          ? { at: time, text: `${isProjectDone(row.project) ? "Done " : ""}${timeAgo(time, now)}` }
          : undefined
      }
      menu={
        <ProjectCommandsMenu
          project={row.project}
          commands={projectCommands(state, row.project)}
          run={run}
          size="list"
        />
      }
    >
      <ItemDescription className="truncate text-xs">{projectsIndexContext(row)}</ItemDescription>
    </ListRow>
  );
}

export function ProjectsIndex({
  state,
  openProject,
}: {
  state: AppState;
  openProject: (projectId: string) => void;
}) {
  const index = projectsIndex(state);
  const now = Date.now();
  const [doneOpen, setDoneOpen] = useState(false);
  return (
    <>
      <PaneHeader actions={<PageHeaderActions page="projects" />}>
        <PaneHeading>
          <h1 className="truncate text-sm font-medium">Projects</h1>
        </PaneHeading>
      </PaneHeader>
      <PaneBody>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6">
          {index.kind === "loading" ? (
            <div aria-hidden className="late-enter flex flex-col gap-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : index.rows.length === 0 && index.done.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TargetIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>No projects yet</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {index.rows.length > 0 && (
                <SettingsList aria-label="Projects">
                  {index.rows.map((row) => (
                    <ProjectRow
                      key={row.project.id}
                      openProject={openProject}
                      state={state}
                      row={row}
                      time={row.updatedAt}
                      now={now}
                    />
                  ))}
                </SettingsList>
              )}
              {index.done.length > 0 && (
                <Collapsible
                  open={doneOpen}
                  onOpenChange={setDoneOpen}
                  className="flex flex-col gap-3"
                >
                  <CollapsibleTrigger
                    render={
                      <button
                        type="button"
                        className="flex min-h-8 items-center gap-1.5 self-start rounded-sm text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRightIcon
                          aria-hidden
                          className={cn(
                            "size-4 text-ink-3 transition-transform",
                            doneOpen && "rotate-90",
                          )}
                        />
                        Done
                        <span className="font-normal text-ink-3 tabular-nums">
                          {index.done.length}
                        </span>
                      </button>
                    }
                  />
                  <CollapsibleContent className="disclosure-content">
                    <SettingsList aria-label="Done projects">
                      {index.done.map((row) => (
                        <ProjectRow
                          key={row.project.id}
                          openProject={openProject}
                          state={state}
                          row={row}
                          time={row.project.doneAt}
                          now={now}
                        />
                      ))}
                    </SettingsList>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </div>
      </PaneBody>
    </>
  );
}
