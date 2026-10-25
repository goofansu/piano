import { cn } from "cn";
import { useCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { PaneBody, PaneHeader, PaneHeading } from "@/components/Pane";
import { ProjectCommandsMenu } from "@/components/Projects";
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import { SettingsList, settingsRow } from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { pageCommands } from "@/lib/globalCommands";
import { projectCommands } from "@/lib/projectCommands";
import { projectsIndex, projectsIndexContext } from "@/lib/projectsIndex";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

/**
 * The Projects index: a listing page shaped as a Settings page is, with its one primary action,
 * New project, from `pageCommands`, which the palette lists too. Each row is the way to one project's
 * home and carries the sidebar's project menu, revealed as there (`RowActions`), its time stepping
 * aside for it; it carries no state, as the
 * index is for scanning. Everything comes from what the browser already holds.
 */
export function ProjectsIndex({ state }: { state: AppState }) {
  const { openProject } = useNavigation();
  const { run } = useCommands();
  const index = projectsIndex(state);
  const actions = pageCommands(state);
  const now = Date.now();
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {index.kind === "loading" ? (
            <div aria-hidden className="late-enter flex flex-col gap-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : index.rows.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyDescription>No projects yet</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <SettingsList aria-label="Projects" className="bg-surface-1">
              {index.rows.map((row) => (
                <Item
                  key={row.project.id}
                  data-row
                  role="listitem"
                  className={cn(
                    settingsRow,
                    rowActionsWidth.list[1],
                    "relative hover:bg-fill-hover",
                  )}
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
                    <ItemDescription className="truncate text-xs">
                      {projectsIndexContext(row)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="text-xs text-ink-3">
                    {row.updatedAt && (
                      <time data-motion="aside" dateTime={row.updatedAt}>
                        {timeAgo(row.updatedAt, now)}
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
              ))}
            </SettingsList>
          )}
        </div>
      </PaneBody>
    </>
  );
}
