import { PROMPT_FIELDS, type Prompt, type PromptField } from "@shared/prompts";
import { MoreHorizontalIcon, SquareSlashIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { PianoButton } from "@/components/PianoButton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { RemovalDialog } from "@/components/RemovalDialog";
import {
  SettingsList,
  SettingsLoadFailure,
  SettingsSectionFrame,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, createPrompt, listPrompts, removePrompt } from "@/lib/api";
import { pageCommands } from "@/lib/globalCommands";
import { useObservation } from "@/lib/useObservation";
import { promptEditor, usePromptEditor } from "@/lib/usePromptEditor";
import { useSetupActions } from "@/lib/useSetupActions";

/** The prompts created in Piano; Pi's own prompt folders are not listed. */
export function PromptSettings() {
  const observed = useObservation("prompts", (signal) => listPrompts({ signal }));
  // New prompt comes from `pageCommands`, which the palette lists too; both open this editor.
  const { state, run, global } = useCommands();
  const editing = usePromptEditor();
  const actions = useSetupActions<Prompt>({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
  });
  const removing = actions.confirmation;
  const busy = actions.running !== undefined;
  return (
    <SettingsSectionFrame
      title="Prompts"
      actions={pageCommands(state, global.settings).map((c) => (
        <Button key={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
          <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
        </Button>
      ))}
      dialogs={
        <>
          {editing && (
            <PromptEditor close={promptEditor.close} refresh={() => void observed.refresh()} />
          )}
          <RemovalDialog
            open={!!removing}
            title="Delete prompt?"
            description={`New sessions no longer offer /${removing?.name ?? ""}.`}
            action="Delete"
            progress="Deleting…"
            busy={busy}
            cancel={actions.cancel}
            confirm={() => {
              const prompt = removing;
              if (!prompt) return;
              void actions.run({
                id: `remove:${prompt.name}`,
                run: () => removePrompt(prompt.name),
                done: "Prompt deleted",
                fallback: "Could not delete prompt.",
              });
            }}
          />
        </>
      }
    >
      {observed.error && (
        <SettingsLoadFailure
          title="Could not load prompts"
          retrying={observed.loading}
          retry={() => void observed.refresh()}
        />
      )}
      {!observed.value ? (
        observed.error ? null : (
          <SettingsSkeleton label="Loading prompts…" className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-14 w-full rounded-lg" />
            ))}
          </SettingsSkeleton>
        )
      ) : observed.value.length === 0 ? (
        <Empty className="border border-dashed border-line py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SquareSlashIcon />
            </EmptyMedia>
            <EmptyTitle className="text-base">No prompts</EmptyTitle>
            <EmptyDescription>
              Create one to use it as a / command in the composer.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <SettingsList>
          {observed.value.map((prompt) => (
            <PromptRow
              key={prompt.name}
              prompt={prompt}
              disabled={busy}
              remove={() => actions.confirm(prompt)}
            />
          ))}
        </SettingsList>
      )}
    </SettingsSectionFrame>
  );
}

/** One prompt: its command as typed in the composer, its argument hint and description. */
function PromptRow({
  prompt,
  disabled,
  remove,
}: {
  prompt: Prompt;
  disabled: boolean;
  remove: () => void;
}) {
  const command = `/${prompt.name}`;
  return (
    <Item className={settingsRow}>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="min-w-0 font-mono">
          <span className="truncate">{command}</span>
          {prompt.argumentHint && (
            <span className="truncate font-normal text-ink-3">{prompt.argumentHint}</span>
          )}
        </ItemTitle>
        {prompt.description && (
          <ItemDescription className="truncate">{prompt.description}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PianoButton
              variant="ghost"
              size="list"
              aria-label={`Prompt actions ${command}`}
              disabled={disabled}
            >
              <MoreHorizontalIcon />
            </PianoButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

function PromptEditor({
  close,
  refresh,
}: {
  close: () => void;
  /** Re-reads the list once a create settles. */
  refresh: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [argumentHint, setArgumentHint] = useState("");
  const [body, setBody] = useState("");
  // A failed create stays in the open dialog, on its field; a created one closes it with a toast.
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  const [errorField, setErrorField] = useState<PromptField | undefined>();
  const errorAt = (field: PromptField | undefined) =>
    actions.error && errorField === field ? actions.error : undefined;
  const nameError = errorAt("name");
  const bodyError = errorAt("body");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const created = await actions.run({
      id: "create",
      run: () =>
        createPrompt({
          name: name.trim(),
          description: description.trim() || undefined,
          argumentHint: argumentHint.trim() || undefined,
          body,
        }).catch((cause: unknown) => {
          const field = cause instanceof ApiError ? cause.field : undefined;
          setErrorField(PROMPT_FIELDS.find((known) => known === field));
          throw cause;
        }),
      done: "Prompt created",
      fallback: "Could not save prompt.",
    });
    if (created) close();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New prompt</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            <Field data-invalid={!!nameError}>
              <FieldLabel htmlFor="prompt-name">Name</FieldLabel>
              <InputGroup>
                <InputGroupAddon className="font-mono">/</InputGroupAddon>
                <InputGroupInput
                  id="prompt-name"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  value={name}
                  aria-invalid={!!nameError}
                  onChange={(e) => setName(e.target.value)}
                />
              </InputGroup>
              {nameError && <FieldError role="alert">{nameError}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="prompt-description">
                Description <span className="font-normal text-ink-3">Optional</span>
              </FieldLabel>
              <Input
                id="prompt-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="prompt-argument-hint">
                Argument hint <span className="font-normal text-ink-3">Optional</span>
              </FieldLabel>
              <Input
                id="prompt-argument-hint"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                value={argumentHint}
                onChange={(e) => setArgumentHint(e.target.value)}
              />
            </Field>
            <Field data-invalid={!!bodyError}>
              <FieldLabel htmlFor="prompt-body">Prompt</FieldLabel>
              <Textarea
                id="prompt-body"
                required
                rows={6}
                className="max-h-80 font-mono"
                value={body}
                aria-invalid={!!bodyError}
                onChange={(e) => setBody(e.target.value)}
              />
              {bodyError && <FieldError role="alert">{bodyError}</FieldError>}
            </Field>
            {errorAt(undefined) && <FieldError role="alert">{errorAt(undefined)}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              Create prompt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
