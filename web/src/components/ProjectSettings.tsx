import { cn } from "cn";
import { type Ref, useId } from "react";
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
import { checkProjectDraft, type ProjectDraft } from "@/lib/projectCommands";

/**
 * A project's settings: its name and instructions, saved together. A view over the command host's
 * Project settings form, which seeds the draft from the saved project and owns submitting; the
 * server answers the save with a toast.
 */
export function ProjectSettingsDialog({
  open,
  draft,
  setDraft,
  allowed,
  submit,
  close,
}: {
  open: boolean;
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  allowed: boolean;
  submit: () => void;
  close: () => void;
}) {
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
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
            <Button type="submit" disabled={!allowed}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A project's two fields, Name and Instructions, as the New project and Project settings dialogs
 * both show them: one shape for creating and editing a project. Each field's count and invalid state
 * are `checkProjectDraft`'s, the rule that also decides whether the dialog may save.
 */
export function ProjectFields({
  id,
  draft,
  setDraft,
  nameRef,
}: {
  id: string;
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  nameRef?: Ref<HTMLInputElement>;
}) {
  const check = checkProjectDraft(draft);
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
        <Input
          id={`${id}-name`}
          ref={nameRef}
          value={draft.name}
          aria-invalid={check.name.over || undefined}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          maxLength={check.name.max}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-instructions`}>Instructions</FieldLabel>
        <Textarea
          id={`${id}-instructions`}
          aria-describedby={`${id}-instructions-count`}
          aria-invalid={check.instructions.over || undefined}
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          className="max-h-[50dvh] min-h-48 font-mono"
        />
        {/* The count, not a maxLength: a paste over the limit stays visible and the count says so, and Save stays off. It counts what saving saves: the trimmed text. */}
        <FieldDescription
          id={`${id}-instructions-count`}
          className={cn(
            "text-right text-xs tabular-nums",
            check.instructions.over ? "text-err" : "text-ink-3",
          )}
        >
          {count.format(check.instructions.length)} / {count.format(check.instructions.max)}
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

/** Characters as the browser counts them (UTF-16 code units), grouped for reading: "20,000". */
const count = new Intl.NumberFormat();
