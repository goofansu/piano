import { cn } from "cn";
import { ChevronRightIcon, TargetIcon } from "lucide-react";
import { useState } from "react";
import { useCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { PaneBody, PaneHeader, PaneHeading } from "@/components/Pane";
import { ProjectCommandsMenu } from "@/components/Projects";
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import { SettingsList, settingsRow } from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { pageCommands } from "@/lib/globalCommands";
import { projectCommands } from "@/lib/projectCommands";
import { type ProjectsIndexRow, projectsIndex, projectsIndexContext } from "@/lib/projectsIndex";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

/**
 * One project's row: the way to its home, its context line, a time at the end and the sidebar's
 * project menu revealed as there (`RowActions`), the time stepping aside for it. `time` is the
 * newest member activity for an open project and when it was marked done under Done.
 */
function ProjectRow({
  state,
  row,
  time,
  now,
}: {
  state: AppState;
  row: ProjectsIndexRow;
  time: string | undefined;
  now: number;
}) {
  const { openProject } = useNavigation();
  const { run } = useCommands();
  return (
    <Item
      data-row
      role="listitem"
      className={cn(settingsRow, rowActionsWidth.list[1], "relative hover:bg-fill-hover")}
    >
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-full min-w-0">
          {/* No row primitive opens on click beside a menu: the name's button stretches over the row. */}
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
            onClick={() => openProject(row.project.id)}
          >
            {row.project.name}
          </button>
        </ItemTitle>
        <ItemDescription className="truncate text-xs">{projectsIndexContext(row)}</ItemDescription>
      </ItemContent>
      <ItemActions className="text-xs text-ink-3">
        {time && (
          <time data-motion="aside" dateTime={time}>
            {timeAgo(time, now)}
          </time>
        )}
        <RowActions className="top-1/2 right-4 -translate-y-1/2">
          <ProjectCommandsMenu
            project={row.project}
            commands={projectCommands(state, row.project)}
            run={run}
            size="list"
          />
        </RowActions>
      </ItemActions>
    </Item>
  );
}

/**
 * The Projects index: a listing page shaped as a Settings page is, with its one primary action,
 * New project, from `pageCommands`, which the palette lists too. Open projects are the list; done
 * ones sit under a Done group at the bottom, folded until opened, so the index stays the list of
 * what is going on. A row carries no state otherwise, as the index is for scanning. Everything
 * comes from what the browser already holds.
 */
export function ProjectsIndex({ state }: { state: AppState }) {
  const { run } = useCommands();
  const index = projectsIndex(state);
  const actions = pageCommands(state);
  const now = Date.now();
  const [doneOpen, setDoneOpen] = useState(false);
  return (
    <>
      <PaneHeader
        actions={actions.map((c) => (
          <Button key={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
            <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
          </Button>
        ))}
      >
        <PaneHeading>
          <h1 className="truncate text-sm font-medium">Projects</h1>
        </PaneHeading>
      </PaneHeader>
      <PaneBody>
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
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
                <SettingsList aria-label="Projects" className="bg-surface-1">
                  {index.rows.map((row) => (
                    <ProjectRow
                      key={row.project.id}
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
                  {/* The group's name folds it, as a sidebar group's does; the count is the one fact beside it. */}
                  <CollapsibleTrigger asChild>
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
                  </CollapsibleTrigger>
                  <CollapsibleContent className="disclosure-content">
                    <SettingsList aria-label="Done projects" className="bg-surface-1">
                      {index.done.map((row) => (
                        <ProjectRow
                          key={row.project.id}
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
