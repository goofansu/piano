import { type ClientCommand, PROJECT_INSTRUCTIONS_MAX, type Project } from "@shared/wire";
import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
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
import { SettingsSkeleton } from "@/components/SettingsSectionFrame";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { findProject, projectCommand, projectSettingsSave } from "@/lib/projectCommands";
import type { AppState } from "@/store";

const title = <h1 className="truncate text-sm font-medium">Project settings</h1>;

/**
 * A project's settings: its name and instructions, edited in place and saved together by the
 * header's Save, the page's one primary action; Delete waits in the header's project menu.
 */
export function ProjectSettings({
  state,
  projectId,
  send,
}: {
  state: AppState;
  projectId: string;
  send: (command: ClientCommand) => void;
}) {
  const project = findProject(state, projectId);
  if (!state.registryLoaded)
    return (
      <>
        <ProjectHeader>{title}</ProjectHeader>
        <Column>
          <SettingsSkeleton label="Loading project…" className="late-enter flex flex-col gap-6">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-56 w-full rounded-lg" />
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
  // A draft belongs to one project: opening another project's settings starts from its own.
  return <ProjectSettingsForm key={project.id} state={state} project={project} send={send} />;
}

function ProjectSettingsForm({
  state,
  project,
  send,
}: {
  state: AppState;
  project: Project;
  send: (command: ClientCommand) => void;
}) {
  const { run } = useCommands();
  const formId = useId();
  const [draft, setDraft] = useState({
    name: project.name,
    instructions: project.instructions ?? "",
  });
  const save = projectSettingsSave(state, project.id, draft);
  const remove = projectCommand(state, project, "delete");
  // A save answers once the registry holds it; a refused one is already told by the client.
  const [saving, setSaving] = useState<typeof draft | null>(null);
  useEffect(() => {
    if (
      saving &&
      project.name === saving.name.trim() &&
      (project.instructions ?? "") === saving.instructions.trim()
    ) {
      toast.success("Project saved");
      setSaving(null);
    }
  }, [saving, project]);
  return (
    <>
      <ProjectHeader
        actions={
          <div className="flex shrink-0 items-center gap-1">
            <Button type="submit" form={formId} size="sm" disabled={!save.allowed}>
              Save
            </Button>
            {remove && (
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
            )}
          </div>
        }
      >
        {title}
      </ProjectHeader>
      <Column>
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.allowed) return;
            for (const command of save.commands) send(command);
            setSaving(draft);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${formId}-name`}>Name</FieldLabel>
              <Input
                id={`${formId}-name`}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                maxLength={200}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${formId}-instructions`}>Instructions</FieldLabel>
              <Textarea
                id={`${formId}-instructions`}
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                maxLength={PROJECT_INSTRUCTIONS_MAX}
                className="min-h-56 font-mono"
              />
            </Field>
          </FieldGroup>
        </form>
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
