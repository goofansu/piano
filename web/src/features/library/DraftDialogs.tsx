import {
  checkDraft,
  DRAFT_FIELDS,
  type Draft,
  type DraftField,
  NAME_RULE,
} from "@shared/features/library/drafts";
import { LIBRARY_KINDS, type LibraryKind } from "@shared/features/library/library";
import { cn } from "cn";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/shared/components/CopyButton";
import { FormDialog, useFieldRefusal } from "@/shared/components/FormDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/PianoDialog";
import { useSetupActions } from "@/shared/lib/useSetupActions";

export function NewDraftDialog({
  kind,
  create,
  extra,
  close,
  refresh,
}: {
  kind: LibraryKind;
  create: (draft: Draft) => Promise<unknown>;
  extra?: ReactNode;
  close: () => void;
  refresh: () => void;
}) {
  const { Noun: Kind } = LIBRARY_KINDS[kind];
  const [draft, setDraft] = useState<Draft>({ name: "", description: "", instructions: "" });
  const edit = (field: DraftField) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  const check = checkDraft(draft);
  const [nameLeft, setNameLeft] = useState(false);
  const nameError = check.malformedName && (nameLeft || /[^a-z0-9-]/.test(draft.name.trim()));
  const refusal = useFieldRefusal(DRAFT_FIELDS, actions.error);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = check.saved;
    if (!saved) return;
    const created = await actions.run({
      id: "create",
      run: () => create(saved).catch(refusal.record),
      done: `${Kind} created`,
      fallback: `Could not create ${kind}.`,
    });
    if (created) close();
  };
  const field = (
    id: DraftField,
    label: string,
    control: (invalid: boolean) => ReactNode,
    counted = false,
  ) => {
    const error = id === "name" && nameError ? NAME_RULE : refusal.at(id);
    return (
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor={`${kind}-${id}`}>{label}</FieldLabel>
        {control(!!error || check[id].over)}
        {counted && (
          <FieldDescription
            id={`${kind}-${id}-count`}
            className={cn(
              "text-right text-xs tabular-nums",
              check[id].over ? "text-err" : "text-ink-3",
            )}
          >
            {count.format(check[id].length)} / {count.format(check[id].max)}
          </FieldDescription>
        )}
        {error && <FieldError role="alert">{error}</FieldError>}
      </Field>
    );
  };
  return (
    <FormDialog busy={busy} close={close} className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>New {kind}</DialogTitle>
        <DialogDescription>Saved in Piano. Sessions started from now can use it.</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)}>
        <FieldGroup>
          {field("name", "Name", (invalid) => (
            <Input
              id={`${kind}-name`}
              required
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={check.name.max}
              className="font-mono"
              value={draft.name}
              aria-invalid={invalid}
              onChange={(e) => edit("name")(e.target.value)}
              onBlur={() => setNameLeft(true)}
            />
          ))}
          {field(
            "description",
            "Description",
            (invalid) => (
              <Textarea
                id={`${kind}-description`}
                required
                rows={3}
                aria-describedby={`${kind}-description-count`}
                value={draft.description}
                aria-invalid={invalid}
                onChange={(e) => edit("description")(e.target.value)}
              />
            ),
            true,
          )}
          {field(
            "instructions",
            "Instructions",
            (invalid) => (
              <Textarea
                id={`${kind}-instructions`}
                required
                aria-describedby={`${kind}-instructions-count`}
                className="max-h-[50dvh] min-h-48 font-mono"
                value={draft.instructions}
                aria-invalid={invalid}
                onChange={(e) => edit("instructions")(e.target.value)}
              />
            ),
            true,
          )}
          {extra}
          {refusal.at(undefined) && <FieldError role="alert">{refusal.at(undefined)}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !check.saved}>
            {busy && <Spinner data-icon="inline-start" />}
            Create {kind}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}

export function DraftFileView({
  kind,
  name,
  file,
  close,
}: {
  kind: LibraryKind;
  name: string;
  file: string;
  close: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="truncate font-mono">{name}</DialogTitle>
        </DialogHeader>
        <DraftFileText kind={kind} name={name} file={file} />
      </DialogContent>
    </Dialog>
  );
}

export function DraftFileText({
  kind,
  name,
  file,
  className,
}: {
  kind: LibraryKind;
  name: string;
  file: string;
  className?: string;
}) {
  const { Noun: Kind, fileLabel } = LIBRARY_KINDS[kind];
  return (
    <div className="relative">
      <Textarea
        readOnly
        aria-label={`${name} ${fileLabel}`}
        spellCheck={false}
        className={cn("max-h-[50dvh] min-h-48 pr-10 font-mono", className)}
        value={file}
      />
      <CopyButton
        text={file}
        label={`Copy ${kind}`}
        copiedLabel={`${Kind} copied`}
        failure={`Could not copy. Select the ${kind} text to copy it.`}
        variant="ghost"
        className="absolute top-2 right-2"
      />
    </div>
  );
}

const count = new Intl.NumberFormat();
