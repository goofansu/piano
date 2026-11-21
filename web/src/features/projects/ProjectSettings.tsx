import { cn } from "cn";
import { type Ref, useId } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  checkProjectDraft,
  type ProjectDraft,
  type ProjectDraftCheck,
} from "@/features/projects/projectCommands";
import { FormDialog } from "@/shared/components/FormDialog";
import {
  type DialogFinalFocus,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/PianoDialog";

export function ProjectSettingsDialog({
  open,
  draft,
  setDraft,
  allowed,
  check,
  submit,
  close,
  finalFocus,
}: {
  open: boolean;
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  allowed: boolean;
  check: ProjectDraftCheck | undefined;
  submit: () => void;
  close: () => void;
  finalFocus?: DialogFinalFocus;
}) {
  const id = useId();
  return (
    <FormDialog open={open} close={close} className="sm:max-w-xl" finalFocus={finalFocus}>
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
        <ProjectFields id={id} draft={draft} setDraft={setDraft} check={check} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!allowed}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}

export function ProjectFields({
  id,
  draft,
  setDraft,
  nameRef,
  check = checkProjectDraft(draft),
}: {
  id: string;
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  nameRef?: Ref<HTMLInputElement>;
  check?: ProjectDraftCheck;
}) {
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

const count = new Intl.NumberFormat();
