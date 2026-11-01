import type { UserSkill } from "@shared/skills";
import { MoreHorizontalIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCommands } from "@/components/CommandHost";
import { DraftFileView, NewDraftDialog, skillEditor } from "@/components/DraftDialogs";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { PianoButton } from "@/components/PianoButton";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { createUserSkill, listUserSkills, removeUserSkill } from "@/lib/api";
import { pageCommands } from "@/lib/globalCommands";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

/** Skills created in Piano, kept in Piano's skills folder: create one, or delete one. */
export function UserSkillSettings() {
  const observed = useObservation("skills", (signal) => listUserSkills({ signal }));
  // New skill comes from `pageCommands`, which the palette lists too; both open this editor.
  const { state, run, global } = useCommands();
  const editing = skillEditor.useOpen();
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
          {viewing && (
            <DraftFileView
              kind="skill"
              name={viewing.name}
              file={viewing.file}
              fileLabel="SKILL.md"
              close={() => setViewing(null)}
            />
          )}
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

/** New skill: the shared draft, and whether only `/skill:<name>` loads it. */
function SkillEditor({ close, refresh }: { close: () => void; refresh: () => void }) {
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  return (
    <NewDraftDialog
      kind="skill"
      create={(draft) => createUserSkill({ ...draft, disableModelInvocation })}
      extra={
        <Field orientation="horizontal" className="items-center gap-2.5">
          <Switch
            id="skill-disable-model-invocation"
            checked={disableModelInvocation}
            onCheckedChange={setDisableModelInvocation}
          />
          <FieldLabel htmlFor="skill-disable-model-invocation">Disable model invocation</FieldLabel>
        </Field>
      }
      close={close}
      refresh={refresh}
    />
  );
}
