import { LIBRARY_KINDS, type LibraryKind } from "@shared/features/library/library";
import type { Prompt } from "@shared/features/library/prompts";
import type { UserSkill } from "@shared/features/library/skills";
import { type LucideIcon, SparklesIcon, SquareSlashIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { ItemDescription } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { PageHeaderActions } from "@/features/commands/PageHeaderActions";
import { DraftFileView, NewDraftDialog } from "@/features/library/DraftDialogs";
import {
  createPrompt,
  createUserSkill,
  listPrompts,
  listUserSkills,
  removePrompt,
  removeUserSkill,
} from "@/features/library/libraryApi";
import { PAGE_EDITORS } from "@/features/settings/pageEditor";
import { settingsLoadView } from "@/features/settings/settingsLoadView";
import {
  SettingsList,
  SettingsLoadState,
  SettingsSectionFrame,
} from "@/features/settings/SettingsSectionFrame";
import { DropdownMenuItem } from "@/shared/components/PianoDropdownMenu";
import { RemovalDialog } from "@/shared/components/RemovalDialog";
import { ListRow, RowMenu } from "@/shared/components/RowActions";
import { useObservation } from "@/shared/lib/useObservation";
import { useSetupActions } from "@/shared/lib/useSetupActions";

export function LibrarySettings({ kind }: { kind: LibraryKind }) {
  return kind === "skill" ? (
    <LibraryPage key={kind} {...skillPage} />
  ) : (
    <LibraryPage key={kind} {...promptPage} />
  );
}

interface LibraryPageKind<Entry extends { name: string; description: string; file: string }> {
  kind: LibraryKind;
  icon: LucideIcon;
  list: (signal: AbortSignal) => Promise<ReadonlyArray<Entry>>;
  remove: (name: string) => Promise<unknown>;
  NewDialog: (props: { close: () => void; refresh: () => void }) => ReactNode;
  badge?: (entry: Entry) => ReactNode;
}

const skillPage: LibraryPageKind<UserSkill> = {
  kind: "skill",
  icon: SparklesIcon,
  list: (signal) => listUserSkills({ signal }),
  remove: removeUserSkill,
  NewDialog: SkillEditor,
  badge: (skill) =>
    skill.disableModelInvocation && (
      <Badge variant="outline" className="font-sans">
        Model invocation off
      </Badge>
    ),
};

const promptPage: LibraryPageKind<Prompt> = {
  kind: "prompt",
  icon: SquareSlashIcon,
  list: (signal) => listPrompts({ signal }),
  remove: removePrompt,
  NewDialog: ({ close, refresh }) => (
    <NewDraftDialog kind="prompt" create={createPrompt} close={close} refresh={refresh} />
  ),
};

const editors = { skill: PAGE_EDITORS.skills.editor, prompt: PAGE_EDITORS.prompts.editor };

function LibraryPage<Entry extends { name: string; description: string; file: string }>({
  kind,
  icon: Icon,
  list,
  remove,
  NewDialog,
  badge,
}: LibraryPageKind<Entry>) {
  const { Noun } = LIBRARY_KINDS[kind];
  const plural = `${kind}s` as const;
  const observed = useObservation(plural, list);
  const editor = editors[kind];
  const editing = editor.useEditing();
  const [viewing, setViewing] = useState<Entry>();
  const actions = useSetupActions<Entry>({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
  });
  const removing = actions.confirmation;
  const busy = actions.running !== undefined;
  return (
    <SettingsSectionFrame
      section={plural}
      actions={<PageHeaderActions page="settings" />}
      dialogs={
        <>
          {viewing && (
            <DraftFileView
              kind={kind}
              name={viewing.name}
              file={viewing.file}
              close={() => setViewing(undefined)}
            />
          )}
          {editing && (
            <NewDialog
              key={editing.key}
              close={editor.close}
              refresh={() => void observed.refresh()}
            />
          )}
          <RemovalDialog
            open={!!removing}
            title={`Delete ${kind}?`}
            description={`Sessions started from now no longer load ${removing?.name ?? `this ${kind}`}.`}
            action="Delete"
            progress="Deleting…"
            busy={busy}
            cancel={actions.cancel}
            confirm={() => {
              const entry = removing;
              if (!entry) return;
              void actions.run({
                id: `remove:${entry.name}`,
                run: () => remove(entry.name),
                done: `${Noun} deleted`,
                fallback: `Could not delete ${kind}.`,
              });
            }}
          />
        </>
      }
    >
      <SettingsLoadState
        view={settingsLoadView({ ...observed, isEmpty: (entries) => entries.length === 0 })}
        noun={plural}
        retry={() => void observed.refresh()}
        emptyIcon={Icon}
      >
        {(entries) => (
          <SettingsList>
            {entries.map((entry) => (
              <LibraryRow
                key={entry.name}
                Noun={Noun}
                name={entry.name}
                description={entry.description}
                badge={badge?.(entry)}
                disabled={busy}
                view={() => setViewing(entry)}
                remove={() => actions.confirm(entry)}
              />
            ))}
          </SettingsList>
        )}
      </SettingsLoadState>
    </SettingsSectionFrame>
  );
}

function LibraryRow({
  Noun,
  name,
  description,
  badge,
  disabled,
  view,
  remove,
}: {
  Noun: string;
  name: string;
  description: string;
  badge: ReactNode;
  disabled: boolean;
  view: () => void;
  remove: () => void;
}) {
  return (
    <ListRow
      title={name}
      titleClassName="font-mono"
      open={{ onOpen: view, disabled }}
      badge={badge}
      menu={
        <RowMenu label={`${Noun} actions ${name}`} disabled={disabled}>
          <DropdownMenuItem variant="destructive" onClick={remove}>
            Delete
          </DropdownMenuItem>
        </RowMenu>
      }
    >
      <ItemDescription className="text-xs">{description}</ItemDescription>
    </ListRow>
  );
}

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
