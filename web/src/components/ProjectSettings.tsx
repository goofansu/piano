import { MoreHorizontalIcon } from "lucide-react";
import { useCommands } from "@/components/CommandHost";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { ProjectHeader } from "@/components/ProjectHome";
import { ProjectCommandIconView } from "@/components/Projects";
import { SettingsList, SettingsSkeleton, settingsRow } from "@/components/SettingsSectionFrame";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectCommand } from "@/lib/projectCommands";
import { findProject, projectCommand, projectSettingsRows } from "@/lib/projectCommands";
import type { AppState } from "@/store";

/**
 * A project's settings, as Settings pages are: hairline-divided rows that each say what they hold
 * and end with the action that changes it, and the project's menu in the header for Delete.
 */
export function ProjectSettings({ state, projectId }: { state: AppState; projectId: string }) {
  const { run } = useCommands();
  const project = findProject(state, projectId);
  if (!state.registryLoaded)
    return (
      <>
        <ProjectHeader>
          <h1 className="truncate text-sm font-medium">Project settings</h1>
        </ProjectHeader>
        <Column>
          <SettingsSkeleton label="Loading project…" className="late-enter flex flex-col gap-2">
            <Skeleton className="h-28 w-full rounded-lg" />
          </SettingsSkeleton>
        </Column>
      </>
    );
  if (!project)
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
  const { rename, instructions } = projectSettingsRows(state, project);
  const remove = projectCommand(state, project, "delete");
  return (
    <>
      <ProjectHeader
        actions={
          remove && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Project menu for ${project.name}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!remove.enabled}
                    onSelect={() => run(remove)}
                  >
                    <ProjectCommandIconView icon={remove.icon} /> {remove.label}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      >
        <h1 className="truncate text-sm font-medium">Project settings</h1>
      </ProjectHeader>
      <Column>
        <SettingsList>
          <Row title="Name" value={project.name} action={rename} run={run} />
          <Row
            title="Instructions"
            value={project.instructions?.split("\n", 1)[0]}
            action={instructions}
            run={run}
          />
        </SettingsList>
      </Column>
    </>
  );
}

/** The Settings column: the width and gutters `SettingsSectionFrame` gives its pages. */
function Column({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">{children}</div>
    </div>
  );
}

/** One setting: its name, its value (or None), and the action that changes it. */
function Row({
  title,
  value,
  action,
  run,
}: {
  title: string;
  value: string | undefined;
  action: ProjectCommand;
  run: (command: ProjectCommand) => void;
}) {
  return (
    <Item role="listitem" className={settingsRow}>
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className={value ? "truncate" : "text-ink-3"}>
          {value ?? "None"}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <Button
          variant="outline"
          size="sm"
          aria-label={action.ariaLabel}
          disabled={!action.enabled}
          onClick={() => run(action)}
        >
          {action.label}
        </Button>
      </ItemActions>
    </Item>
  );
}
