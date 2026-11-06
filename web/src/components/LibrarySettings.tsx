import { LIBRARY_KINDS, type LibraryKind } from "@shared/library";
import type { Prompt } from "@shared/prompts";
import type { UserSkill } from "@shared/skills";
import { type LucideIcon, MoreHorizontalIcon, SparklesIcon, SquareSlashIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useCommands } from "@/components/CommandHost";
import {
  DraftFileView,
  NewDraftDialog,
  promptEditor,
  skillEditor,
} from "@/components/DraftDialogs";
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
import {
  createPrompt,
  createUserSkill,
  listPrompts,
  listUserSkills,
  removePrompt,
  removeUserSkill,
} from "@/lib/api";
import { pageCommands } from "@/lib/globalCommands";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

/** Settings › Skills or Settings › Prompts: the entries created in Piano, kept in Piano's own
 * folder; Pi's own folders are not listed. */
export function LibrarySettings({ kind }: { kind: LibraryKind }) {
  // Keyed by kind, so moving between the two pages starts the other page afresh.
  return kind === "skill" ? (
    <LibraryPage key={kind} {...skillPage} />
  ) : (
    <LibraryPage key={kind} {...promptPage} />
  );
}

/** What one kind's page does that the other does not; the words come from `LIBRARY_KINDS`. */
interface LibraryPageKind<Entry extends { name: string; description: string; file: string }> {
  kind: LibraryKind;
  /** The empty list's icon. */
  icon: LucideIcon;
  list: (signal: AbortSignal) => Promise<ReadonlyArray<Entry>>;
  remove: (name: string) => Promise<unknown>;
  /** The creation dialog, opened by the header's New command or the palette's. */
  NewDialog: (props: { close: () => void; refresh: () => void }) => ReactNode;
  /** Marks after an entry's name, such as a skill's Disable model invocation. */
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
        Disable model invocation
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

const editors = { skill: skillEditor, prompt: promptEditor };

function LibraryPage<Entry extends { name: string; description: string; file: string }>({
  kind,
  icon: Icon,
  list,
  remove,
  NewDialog,
  badge,
}: LibraryPageKind<Entry>) {
  const { Noun } = LIBRARY_KINDS[kind];
  const plural = `${kind}s`;
  const observed = useObservation(plural, list);
  // New comes from `pageCommands`, which the palette lists too; both open this editor.
  const { state, run, global } = useCommands();
  const editor = editors[kind];
  const editing = editor.useOpen();
  const [viewing, setViewing] = useState<Entry>();
  const actions = useSetupActions<Entry>({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
  });
  const removing = actions.confirmation;
  const busy = actions.running !== undefined;
  return (
    <SettingsSectionFrame
      title={`${Noun}s`}
      actions={pageCommands(state, global.settings).map((c) => (
        <Button key={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
          <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
        </Button>
      ))}
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
          {editing && <NewDialog close={editor.close} refresh={() => void observed.refresh()} />}
          <RemovalDialog
            open={!!removing}
            title={`Delete ${kind}?`}
            description={`${removing?.name ?? `This ${kind}`} is removed. Sessions started from now no longer load it.`}
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
      {/* The failure stays while Retry reads again, so it does not flicker into the skeleton. */}
      {observed.error && (
        <SettingsLoadFailure
          title={`Could not load ${plural}`}
          retrying={observed.loading}
          retry={() => void observed.refresh()}
        />
      )}
      {!observed.value ? (
        observed.error ? null : (
          <SettingsSkeleton label={`Loading ${plural}…`} className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-14 w-full rounded-lg" />
            ))}
          </SettingsSkeleton>
        )
      ) : observed.value.length === 0 ? (
        <Empty className="border border-dashed border-line py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon />
            </EmptyMedia>
            <EmptyTitle className="text-base">{`No ${plural}`}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <SettingsList>
          {observed.value.map((entry) => (
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
    </SettingsSectionFrame>
  );
}

/** One entry: its name, any badge, its description, and its View and Delete menu. */
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
    <Item className={settingsRow}>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="font-mono">
          <span className="truncate">{name}</span>
          {badge}
        </ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PianoButton
              variant="ghost"
              size="list"
              aria-label={`${Noun} actions ${name}`}
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
