import type { Prompt } from "@shared/prompts";
import { MoreHorizontalIcon, SquareSlashIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCommands } from "@/components/CommandHost";
import { DraftFileView, NewDraftDialog, promptEditor } from "@/components/DraftDialogs";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { PianoButton } from "@/components/PianoButton";
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { createPrompt, listPrompts, removePrompt } from "@/lib/api";
import { pageCommands } from "@/lib/globalCommands";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

/** The prompts created in Piano; Pi's own prompt folders are not listed. */
export function PromptSettings() {
  const observed = useObservation("prompts", (signal) => listPrompts({ signal }));
  // New prompt comes from `pageCommands`, which the palette lists too; both open this editor.
  const { state, run, global } = useCommands();
  const editing = promptEditor.useOpen();
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
          {viewing && (
            <DraftFileView
              kind="prompt"
              name={viewing.name}
              file={viewing.file}
              fileLabel="file"
              close={() => setViewing(undefined)}
            />
          )}
          {editing && (
            <NewDraftDialog
              kind="prompt"
              create={createPrompt}
              close={promptEditor.close}
              refresh={() => void observed.refresh()}
            />
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
