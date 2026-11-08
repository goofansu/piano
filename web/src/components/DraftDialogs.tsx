/**
 * The dialogs Settings › Skills and Settings › Prompts share: New skill and New prompt edit one
 * draft (`checkDraft`, the rule the server applies), and View shows the file exactly as saved.
 */
import { checkDraft, DRAFT_FIELDS, type Draft, type DraftField, NAME_RULE } from "@shared/drafts";
import { LIBRARY_KINDS, type LibraryKind } from "@shared/library";
import { cn } from "cn";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/CopyButton";
import { FormDialog, useFieldRefusal } from "@/components/FormDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useSetupActions } from "@/lib/useSetupActions";

/**
 * A page's one creation dialog, so it opens the same dialog whether the page's header or the command
 * palette ran it. `useOpen` reads it while the page is mounted; leaving the page closes it.
 */
export function draftEditor() {
  let open = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    open = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getState = () => open;
  const close = () => set(false);
  return {
    open: () => set(true),
    close,
    useOpen: () => {
      useEffect(() => close, []);
      return useSyncExternalStore(subscribe, getState);
    },
  };
}

export const skillEditor = draftEditor();
export const promptEditor = draftEditor();

/** New skill or New prompt: Create stays off until the draft passes the server’s rule. */
export function NewDraftDialog({
  kind,
  create,
  extra,
  close,
  refresh,
}: {
  /** What is created, lowercase: "skill" names the title, Create button, ids and messages. */
  kind: LibraryKind;
  /** Saves the trimmed draft; a refusal naming a field shows on that field. */
  create: (draft: Draft) => Promise<unknown>;
  /** Controls after the draft's fields, such as a skill's Disable model invocation. */
  extra?: ReactNode;
  close: () => void;
  /** Re-reads the list once a create settles. */
  refresh: () => void;
}) {
  const { Noun: Kind } = LIBRARY_KINDS[kind];
  const [draft, setDraft] = useState<Draft>({ name: "", description: "", instructions: "" });
  const edit = (field: DraftField) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  // A refused create stays in the open dialog, on its field; a created one closes it with a toast.
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  const check = checkDraft(draft);
  // A character the rule never allows answers as it is typed; a misplaced hyphen waits until the
  // field is left, so typing "release-" on the way to "release-notes" is not an error. Whether the
  // name is free, only the server can say.
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
        {/* The count, as New project's instructions: it counts the trimmed text, and over the limit
         * (a paste into a field that takes no maxLength) it turns red and Create stays off. */}
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

/** One skill or prompt, read-only: its file exactly as saved, to read and copy. */
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

/** A skill's or prompt's file as plain text, never rendered: read-only, copyable. View shows it,
 * and so does the proposal card for a new one. */
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

/** Characters as the browser counts them (UTF-16 code units), grouped for reading: "20,000". */
const count = new Intl.NumberFormat();
