import { checkDraft, DRAFT_FIELDS, type DraftField, NAME_RULE } from "@shared/drafts";
import type { Prompt } from "@shared/prompts";
import { cn } from "cn";
import { MoreHorizontalIcon, SquareSlashIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCommands } from "@/components/CommandHost";
import { CopyButton } from "@/components/CopyButton";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { PianoButton } from "@/components/PianoButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const [viewing, setViewing] = useState<Prompt>();
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
          {viewing && <PromptView prompt={viewing} close={() => setViewing(undefined)} />}
          {editing && (
            <PromptEditor close={promptEditor.close} refresh={() => void observed.refresh()} />
          )}
          <RemovalDialog
            open={!!removing}
            title="Delete prompt?"
            description={`${removing?.name ?? "This prompt"} is removed. Sessions started from now no longer load it.`}
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
          </EmptyHeader>
        </Empty>
      ) : (
        <SettingsList>
          {observed.value.map((prompt) => (
            <PromptRow
              key={prompt.name}
              prompt={prompt}
              disabled={busy}
              view={() => setViewing(prompt)}
              remove={() => actions.confirm(prompt)}
            />
          ))}
        </SettingsList>
      )}
    </SettingsSectionFrame>
  );
}

/** One prompt: its name and description, as a skill is shown. */
function PromptRow({
  prompt,
  disabled,
  view,
  remove,
}: {
  prompt: Prompt;
  disabled: boolean;
  view: () => void;
  remove: () => void;
}) {
  return (
    <Item className={settingsRow}>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="font-mono">
          <span className="truncate">{prompt.name}</span>
        </ItemTitle>
        <ItemDescription>{prompt.description}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PianoButton
              variant="ghost"
              size="list"
              aria-label={`Prompt actions ${prompt.name}`}
              disabled={disabled}
            >
              <MoreHorizontalIcon />
            </PianoButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={view}>View</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

/** One prompt, read-only: its template file exactly as saved, to read and copy. */
function PromptView({ prompt, close }: { prompt: Prompt; close: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="truncate font-mono">{prompt.name}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Textarea
            readOnly
            aria-label={`${prompt.name} file`}
            spellCheck={false}
            className="max-h-[50dvh] min-h-48 pr-10 font-mono"
            value={prompt.file}
          />
          <CopyButton
            text={prompt.file}
            label="Copy prompt"
            copiedLabel="Prompt copied"
            failure="Couldn’t copy. Select the prompt text to copy it."
            variant="ghost"
            className="absolute top-2 right-2"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Laid out as New skill: the same rule the server applies keeps Create prompt off until the name
 * and prompt are filled and every field is within its limit. */
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
  const [instructions, setInstructions] = useState("");
  // A refused create stays in the open dialog, on its field; a created one closes it with a toast.
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  const check = checkDraft({ name, description, instructions });
  // As New skill: a character the rule never allows answers as it is typed; a misplaced hyphen
  // waits until the field is left. Whether the name is free, only the server can say.
  const [nameLeft, setNameLeft] = useState(false);
  const nameError = check.malformedName && (nameLeft || /[^a-z0-9-]/.test(name.trim()));
  const [errorField, setErrorField] = useState<DraftField | undefined>();
  const errorAt = (field: DraftField | undefined) =>
    actions.error && errorField === field ? actions.error : undefined;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = check.saved;
    if (!saved) return;
    const created = await actions.run({
      id: "create",
      run: () =>
        createPrompt(saved).catch((cause: unknown) => {
          const field = cause instanceof ApiError ? cause.field : undefined;
          setErrorField(DRAFT_FIELDS.find((known) => known === field));
          throw cause;
        }),
      done: "Prompt created",
      fallback: "Could not create prompt.",
    });
    if (created) close();
  };
  const field = (
    id: DraftField,
    label: string,
    control: (invalid: boolean) => React.ReactNode,
    counted = false,
  ) => {
    const error = id === "name" && nameError ? NAME_RULE : errorAt(id);
    return (
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor={`prompt-${id}`}>{label}</FieldLabel>
        {control(!!error || check[id].over)}
        {/* The count, as New skill's: it counts the trimmed text, and over the limit (a paste into
         * a field that takes no maxLength) it turns red and Create prompt stays off. */}
        {counted && (
          <FieldDescription
            id={`prompt-${id}-count`}
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New prompt</DialogTitle>
          <DialogDescription>
            Saved in Piano. Sessions started from now can use it.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {field("name", "Name", (invalid) => (
              <Input
                id="prompt-name"
                required
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={check.name.max}
                className="font-mono"
                value={name}
                aria-invalid={invalid}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameLeft(true)}
              />
            ))}
            {field(
              "description",
              "Description",
              (invalid) => (
                <Textarea
                  id="prompt-description"
                  required
                  rows={3}
                  aria-describedby="prompt-description-count"
                  value={description}
                  aria-invalid={invalid}
                  onChange={(e) => setDescription(e.target.value)}
                />
              ),
              true,
            )}
            {field(
              "instructions",
              "Instructions",
              (invalid) => (
                <Textarea
                  id="prompt-instructions"
                  required
                  aria-describedby="prompt-instructions-count"
                  className="max-h-[50dvh] min-h-48 font-mono"
                  value={instructions}
                  aria-invalid={invalid}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              ),
              true,
            )}
            {errorAt(undefined) && <FieldError role="alert">{errorAt(undefined)}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !check.saved}>
              {busy && <Spinner data-icon="inline-start" />}
              Create prompt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Characters as the browser counts them (UTF-16 code units), grouped for reading: "20,000". */
const count = new Intl.NumberFormat();
