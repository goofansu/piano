import { checkDraft, DRAFT_FIELDS, type DraftField, NAME_RULE } from "@shared/drafts";
import type { UserSkill } from "@shared/skills";
import { cn } from "cn";
import { MoreHorizontalIcon, SparklesIcon } from "lucide-react";
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
  DropdownMenuGroup,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, createUserSkill, listUserSkills, removeUserSkill } from "@/lib/api";
import { pageCommands } from "@/lib/globalCommands";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";
import { skillEditor, useSkillEditor } from "@/lib/useSkillEditor";

/** Skills created in Piano, kept in Piano's skills folder: create one, or delete one. */
export function UserSkillSettings() {
  const observed = useObservation("skills", (signal) => listUserSkills({ signal }));
  // New skill comes from `pageCommands`, which the palette lists too; both open this editor.
  const { state, run, global } = useCommands();
  const editing = useSkillEditor();
  const actions = useSetupActions<UserSkill>({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
  });
  const removing = actions.confirmation;
  const [viewing, setViewing] = useState<UserSkill | null>(null);
  const busy = actions.running !== undefined;
  return (
    <SettingsSectionFrame
      title="Skills"
      actions={pageCommands(state, global.settings).map((c) => (
        <Button key={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
          <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
        </Button>
      ))}
      dialogs={
        <>
          {viewing && <SkillViewer skill={viewing} close={() => setViewing(null)} />}
          {editing && (
            <SkillEditor close={skillEditor.close} refresh={() => void observed.refresh()} />
          )}
          <RemovalDialog
            open={!!removing}
            title="Delete skill?"
            description={`${removing?.name ?? "This skill"} is removed. Sessions started from now no longer load it.`}
            action="Delete"
            progress="Deleting…"
            busy={busy}
            cancel={actions.cancel}
            confirm={() => {
              const skill = removing;
              if (!skill) return;
              void actions.run({
                id: `remove:${skill.name}`,
                run: () => removeUserSkill(skill.name),
                done: "Skill deleted",
                fallback: "Could not delete skill.",
              });
            }}
          />
        </>
      }
    >
      {/* The failure stays while Retry reads again, so it does not flicker into the skeleton. */}
      {observed.error && (
        <SettingsLoadFailure
          title="Could not load skills"
          retrying={observed.loading}
          retry={() => void observed.refresh()}
        />
      )}
      {!observed.value ? (
        observed.error ? null : (
          <SettingsSkeleton label="Loading skills…" className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-14 w-full rounded-lg" />
            ))}
          </SettingsSkeleton>
        )
      ) : observed.value.length === 0 ? (
        <Empty className="border border-dashed border-line py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle className="text-base">No skills</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <SettingsList>
          {observed.value.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              disabled={busy}
              view={() => setViewing(skill)}
              remove={() => actions.confirm(skill)}
            />
          ))}
        </SettingsList>
      )}
    </SettingsSectionFrame>
  );
}

function SkillRow({
  skill,
  disabled,
  view,
  remove,
}: {
  skill: UserSkill;
  disabled: boolean;
  view: () => void;
  remove: () => void;
}) {
  return (
    <Item className={settingsRow}>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="font-mono">
          <span className="truncate">{skill.name}</span>
          {skill.disableModelInvocation && (
            <Badge variant="outline" className="font-sans">
              Disable model invocation
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription>{skill.description}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PianoButton
              variant="ghost"
              size="list"
              aria-label={`Skill actions ${skill.name}`}
              disabled={disabled}
            >
              <MoreHorizontalIcon />
            </PianoButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={view}>View</DropdownMenuItem>
            </DropdownMenuGroup>
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

function SkillEditor({
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
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  // A refused create stays in the open dialog, on its field; a created one closes it with a toast.
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  // The same rule the server applies: Create skill stays off until every field is filled and in bounds.
  const check = checkDraft({ name, description, instructions });
  // A character the rule never allows answers as it is typed; a misplaced hyphen waits until the
  // field is left, so typing "release-" on the way to "release-notes" is not an error. Whether the
  // name is free, only the server can say.
  const [nameLeft, setNameLeft] = useState(false);
  const nameError = check.malformedName && (nameLeft || /[^a-z0-9-]/.test(name.trim()));
  const [errorField, setErrorField] = useState<DraftField | undefined>();
  const errorAt = (field: DraftField | undefined) =>
    actions.error && errorField === field ? actions.error : undefined;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!check.saved) return;
    const created = await actions.run({
      id: "create",
      run: () =>
        createUserSkill({ name, description, instructions, disableModelInvocation }).catch(
          (cause: unknown) => {
            const field = cause instanceof ApiError ? cause.field : undefined;
            setErrorField(DRAFT_FIELDS.find((known) => known === field));
            throw cause;
          },
        ),
      done: "Skill created",
      fallback: "Could not create skill.",
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
        <FieldLabel htmlFor={`skill-${id}`}>{label}</FieldLabel>
        {control(!!error || check[id].over)}
        {/* The count, as New project's instructions: it counts the trimmed text, and over the limit
         * (a paste into Instructions, which takes no maxLength) it turns red and Create skill stays off. */}
        {counted && (
          <FieldDescription
            id={`skill-${id}-count`}
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
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>
            Saved in Piano. Sessions started from now can use it.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {field("name", "Name", (invalid) => (
              <Input
                id="skill-name"
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
                  id="skill-description"
                  required
                  rows={3}
                  aria-describedby="skill-description-count"
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
                  id="skill-instructions"
                  required
                  aria-describedby="skill-instructions-count"
                  className="max-h-[50dvh] min-h-48 font-mono"
                  value={instructions}
                  aria-invalid={invalid}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              ),
              true,
            )}
            <Field orientation="horizontal" className="items-center gap-2.5">
              <Switch
                id="skill-disable-model-invocation"
                checked={disableModelInvocation}
                onCheckedChange={setDisableModelInvocation}
              />
              <FieldLabel htmlFor="skill-disable-model-invocation">
                Disable model invocation
              </FieldLabel>
            </Field>
            {errorAt(undefined) && <FieldError role="alert">{errorAt(undefined)}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !check.saved}>
              {busy && <Spinner data-icon="inline-start" />}
              Create skill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One skill, read-only: its SKILL.md exactly as saved, to read and copy. */
function SkillViewer({ skill, close }: { skill: UserSkill; close: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="truncate font-mono">{skill.name}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Textarea
            readOnly
            aria-label={`${skill.name} SKILL.md`}
            spellCheck={false}
            className="max-h-[50dvh] min-h-48 pr-10 font-mono"
            value={skill.file}
          />
          <CopyButton
            text={skill.file}
            label="Copy skill"
            copiedLabel="Skill copied"
            failure="Couldn’t copy. Select the skill text to copy it."
            variant="ghost"
            className="absolute top-2 right-2"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Characters as the browser counts them (UTF-16 code units), grouped for reading: "20,000". */
const count = new Intl.NumberFormat();
