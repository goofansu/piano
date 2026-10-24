import { type ClientCommand, PROJECT_INSTRUCTIONS_MAX, type Project } from "@shared/wire";
import { cn } from "cn";
import { type Ref, useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
      <ProjectFields id={id} draft={draft} setDraft={setDraft} />
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

/**
 * A project's two fields, Name and Instructions, as the New project and Project settings dialogs
 * both show them: one shape for creating and editing a project.
 */
export function ProjectFields({
  id,
  draft,
  setDraft,
  nameRef,
}: {
  id: string;
  draft: ProjectSettingsDraft;
  setDraft: (draft: ProjectSettingsDraft) => void;
  nameRef?: Ref<HTMLInputElement>;
}) {
  const over = draft.instructions.length > PROJECT_INSTRUCTIONS_MAX;
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
        <Input
          id={`${id}-name`}
          ref={nameRef}
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
          aria-describedby={`${id}-instructions-count`}
          aria-invalid={over || undefined}
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          className="max-h-[50dvh] min-h-48 font-mono"
        />
        {/* The count, not a maxLength: a paste over the limit stays visible and the count says so, and Save stays off. */}
        <FieldDescription
          id={`${id}-instructions-count`}
          className={cn("text-right text-xs tabular-nums", over ? "text-err" : "text-ink-3")}
        >
          {count.format(draft.instructions.length)} / {count.format(PROJECT_INSTRUCTIONS_MAX)}
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

/** Characters as the browser counts them (UTF-16 code units), grouped for reading: "20,000". */
const count = new Intl.NumberFormat();
