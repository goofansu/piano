import { USER_SKILL_FIELDS, type UserSkill, type UserSkillField } from "@shared/skills";
import { MoreHorizontalIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCommands } from "@/components/CommandHost";
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, createUserSkill, listUserSkills, removeUserSkill } from "@/lib/api";
import { pageCommands } from "@/lib/globalCommands";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";
import { skillEditor, useSkillEditor } from "@/lib/useSkillEditor";

/** Skills created in Piano, kept in ~/.agents/skills: create one, or delete one Piano created. */
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
          {editing && (
            <SkillEditor close={skillEditor.close} refresh={() => void observed.refresh()} />
          )}
          <RemovalDialog
            open={!!removing}
            title="Delete skill?"
            description={`${removing?.name ?? "This skill"} and its folder in ~/.agents/skills are removed. Sessions started from now no longer load it.`}
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
            <EmptyDescription>Create one for Pi to load when a task matches it.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <SettingsList>
          {observed.value.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              disabled={busy}
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
  remove,
}: {
  skill: UserSkill;
  disabled: boolean;
  remove: () => void;
}) {
  return (
    <Item className={settingsRow}>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="font-mono">
          <span className="truncate">{skill.name}</span>
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
  // A refused create stays in the open dialog, on its field; a created one closes it with a toast.
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  const [errorField, setErrorField] = useState<UserSkillField | undefined>();
  const errorAt = (field: UserSkillField | undefined) =>
    actions.error && errorField === field ? actions.error : undefined;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const created = await actions.run({
      id: "create",
      run: () =>
        createUserSkill({ name, description, instructions }).catch((cause: unknown) => {
          const field = cause instanceof ApiError ? cause.field : undefined;
          setErrorField(USER_SKILL_FIELDS.find((known) => known === field));
          throw cause;
        }),
      done: "Skill created",
      fallback: "Could not create skill.",
    });
    if (created) close();
  };
  const field = (
    id: UserSkillField,
    label: string,
    control: (invalid: boolean) => React.ReactNode,
  ) => {
    const error = errorAt(id);
    return (
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor={`skill-${id}`}>{label}</FieldLabel>
        {control(!!error)}
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>
            Saved in ~/.agents/skills. Sessions started from now can use it.
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
                maxLength={64}
                className="font-mono"
                value={name}
                aria-invalid={invalid}
                onChange={(e) => setName(e.target.value)}
              />
            ))}
            {field("description", "Description", (invalid) => (
              <Textarea
                id="skill-description"
                required
                rows={3}
                maxLength={1024}
                value={description}
                aria-invalid={invalid}
                onChange={(e) => setDescription(e.target.value)}
              />
            ))}
            {field("instructions", "Instructions", (invalid) => (
              <Textarea
                id="skill-instructions"
                required
                rows={8}
                className="max-h-80 font-mono text-xs"
                value={instructions}
                aria-invalid={invalid}
                onChange={(e) => setInstructions(e.target.value)}
              />
            ))}
            {errorAt(undefined) && <FieldError role="alert">{errorAt(undefined)}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              Create skill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
