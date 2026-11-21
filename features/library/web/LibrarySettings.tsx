import type { Prompt } from "@features/library/contracts/prompts";
import type { UserSkill } from "@features/library/contracts/skills";
import { DraftFileView, NewDraftDialog } from "@features/library/web/DraftDialogs";
import {
  createPrompt,
  createUserSkill,
  listPrompts,
  listUserSkills,
  removePrompt,
  removeUserSkill,
} from "@features/library/web/libraryApi";
import { type LucideIcon, SparklesIcon, SquareSlashIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { ItemDescription } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { DropdownMenuItem } from "@/shared/components/PianoDropdownMenu";
import { RemovalDialog } from "@/shared/components/RemovalDialog";
import { ListRow, RowMenu } from "@/shared/components/RowActions";
import {
  SettingsList,
  SettingsLoadState,
  SettingsSectionFrame,
} from "@/shared/components/SettingsSectionFrame";
import type { PageEditorProps } from "@/shared/lib/pageEditor";
import { settingsLoadView } from "@/shared/lib/settingsLoadView";
import { useObservation } from "@/shared/lib/useObservation";
import { useSetupActions } from "@/shared/lib/useSetupActions";
import { LIBRARY_KINDS, type LibraryKind } from "../../../shared/session/libraryTools.ts";

export function LibrarySettings({ kind, ...editorProps }: { kind: LibraryKind } & PageEditorProps) {
  return kind === "skill" ? (
    <LibraryPage key={kind} {...skillPage} {...editorProps} />
  ) : (
    <LibraryPage key={kind} {...promptPage} {...editorProps} />
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

function LibraryPage<Entry extends { name: string; description: string; file: string }>({
  kind,
  icon: Icon,
  list,
  remove,
  NewDialog,
  badge,
  editor,
  headerActions,
}: LibraryPageKind<Entry> & PageEditorProps) {
  const { Noun } = LIBRARY_KINDS[kind];
  const plural = `${kind}s` as const;
  const observed = useObservation(plural, list);
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
      actions={headerActions}
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
