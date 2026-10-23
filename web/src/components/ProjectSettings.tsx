import { type ClientCommand, PROJECT_INSTRUCTIONS_MAX, type Project } from "@shared/wire";
import { useId, useState } from "react";
import { useCommands } from "@/components/CommandHost";
import { ProjectHeader } from "@/components/ProjectHome";
import { SettingsList, settingsRow } from "@/components/SettingsSectionFrame";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Textarea } from "@/components/ui/textarea";
import { findProject, projectCommand, projectSettingsSave } from "@/lib/projectCommands";
import type { AppState } from "@/store";

/**
 * A project's settings: its name and instructions, edited in place and saved together from the
 * header, and its deletion, which asks first.
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
  if (!state.registryLoaded) return null;
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
  return (
    <>
      <ProjectHeader
        actions={
          <Button type="submit" form={formId} size="sm" disabled={!save.allowed}>
            Save
          </Button>
        }
      >
        <h1 className="truncate text-sm font-medium">Project settings</h1>
        {/* Plain project metadata has no dedicated UI primitive. */}
        <p className="truncate text-xs text-ink-3">{project.name}</p>
      </ProjectHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:py-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-8">
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              if (save.allowed) for (const command of save.commands) send(command);
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
                  className="min-h-48 font-mono text-sm"
                />
                <FieldDescription>
                  Pi adds these to the system prompt of every session in this project. A session
                  already running gets them when it next starts.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
          {remove && (
            <SettingsList>
              <Item role="listitem" className={settingsRow}>
                <ItemContent>
                  <ItemTitle>Delete project</ItemTitle>
                  <ItemDescription>Its sessions are kept, in no project.</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!remove.enabled}
                    onClick={() => run(remove)}
                  >
                    Delete
                  </Button>
                </ItemActions>
              </Item>
            </SettingsList>
          )}
        </div>
      </div>
    </>
  );
}
