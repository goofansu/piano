import { type ClientCommand, PROJECT_INSTRUCTIONS_MAX, type Project } from "@shared/wire";
import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type ProjectSettingsDraft, projectSettingsSave } from "@/lib/projectCommands";
import type { AppState } from "@/store";

/**
 * A project's settings: its name and instructions, saved together. The command host owns the one
 * instance (which project is open); the server answers the save with a toast.
 */
export function ProjectSettingsDialog({
  state,
  project,
  send,
  close,
}: {
  state: AppState;
  /** The project being edited; undefined while the dialog is closed. */
  project: Project | undefined;
  send: (command: ClientCommand) => void;
  close: () => void;
}) {
  return (
    <Dialog open={!!project} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
        {/* A draft belongs to one opening: reopening, or another project, starts from what is saved. */}
        {project && (
          <ProjectSettingsForm
            key={project.id}
            state={state}
            project={project}
            send={send}
            close={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectSettingsForm({
  state,
  project,
  send,
  close,
}: {
  state: AppState;
  project: Project;
  send: (command: ClientCommand) => void;
  close: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<ProjectSettingsDraft>({
    name: project.name,
    instructions: project.instructions ?? "",
  });
  const save = projectSettingsSave(state, project.id, draft);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.allowed) return;
        send(save.command);
        close();
      }}
    >
      <DialogHeader>
        <DialogTitle>Project settings</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            maxLength={200}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-instructions`}>Instructions</FieldLabel>
          <Textarea
            id={`${id}-instructions`}
            value={draft.instructions}
            onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
            maxLength={PROJECT_INSTRUCTIONS_MAX}
            className="max-h-[50dvh] min-h-48 font-mono"
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={!save.allowed}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
