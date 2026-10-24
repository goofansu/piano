import { useCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { PaneBody, PaneHeader, PaneHeading } from "@/components/Pane";
import { SettingsList, settingsRow } from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { pageCommands } from "@/lib/globalCommands";
import { projectsIndex, projectsIndexContext } from "@/lib/projectsIndex";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

/**
 * The Projects index: a listing page shaped as a Settings page is, with its one primary action,
 * New project, from `pageCommands`, which the palette lists too. Each row is the way to one project's home; it carries no menu and no state, as
 * the index is for scanning. Everything comes from what the browser already holds.
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
                  asChild
                  role="listitem"
                  className={`${settingsRow} text-left hover:bg-fill-hover`}
                >
                  <button type="button" onClick={() => openProject(row.project.id)}>
                    <ItemContent className="min-w-0 gap-0.5">
                      <ItemTitle className="w-full min-w-0">
                        <span className="min-w-0 flex-1 truncate">{row.project.name}</span>
                      </ItemTitle>
                      <ItemDescription className="truncate text-xs">
                        {projectsIndexContext(row)}
                      </ItemDescription>
                    </ItemContent>
                    {row.updatedAt && (
                      <ItemActions className="self-start text-xs text-ink-3">
                        <time dateTime={row.updatedAt}>{timeAgo(row.updatedAt, now)}</time>
                      </ItemActions>
                    )}
                  </button>
                </Item>
              ))}
            </SettingsList>
          )}
        </div>
      </PaneBody>
    </>
  );
}
