import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiKeyDialog } from "@/components/ApiKeyDialog";
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
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import {
  SettingsList,
  SettingsLoadFailure,
  SettingsSectionFrame,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useSetupActions } from "@/lib/useSetupActions";
import { useVoiceInput, voiceInputSettings } from "@/lib/useVoiceInput";

/** Why the key dialog is open: turning voice input on, or replacing the saved key. */
type KeyEditing = "turn-on" | "replace";

export function PreferencesSettings() {
  // The same state every composer reads, so a save here shows or hides their mic at once.
  const observed = useVoiceInput();
  const [editing, setEditing] = useState<KeyEditing>();
  const actions = useSetupActions<"remove-key">({
    refresh: () => void voiceInputSettings.refresh(),
    success: (text) => toast.success(text),
  });
  const busy = actions.running !== undefined;
  const voice = observed.value;
  const setEnabled = (enabled: boolean) => {
    if (!voice) return;
    if (enabled && !voice.hasKey) {
      setEditing("turn-on");
      return;
    }
    void actions.run({
      id: "voice-input",
      run: () => voiceInputSettings.save({ enabled }),
      done: enabled ? "Voice input turned on" : "Voice input turned off",
      fallback: "Could not save voice input.",
    });
  };
  return (
    <SettingsSectionFrame
      title="Preferences"
      titleId="settings-preferences-title"
      sectionId="settings-preferences"
      dialogs={
        <>
          {editing && voice && (
            <ApiKeyDialog
              title="OpenAI API key"
              description="Voice input sends recordings and session context to OpenAI."
              // Saving a key while turning on also turns voice input on; replacing keeps it as is.
              save={(key) =>
                voiceInputSettings.save({ enabled: editing === "turn-on" || voice.enabled, key })
              }
              done={editing === "turn-on" ? "Voice input turned on" : "OpenAI API key saved"}
              fallback="Could not save API key."
              close={() => setEditing(undefined)}
              refresh={() => void voiceInputSettings.refresh()}
            />
          )}
          <RemovalDialog
            open={actions.confirmation === "remove-key"}
            title="Remove OpenAI API key?"
            description="Turns voice input off and deletes the key from Piano, without revoking it at OpenAI."
            action="Remove key"
            progress="Removing…"
            busy={busy}
            cancel={actions.cancel}
            confirm={() =>
              void actions.run({
                id: "remove-key",
                run: () => voiceInputSettings.save({ enabled: false, key: null }),
                done: "OpenAI API key removed",
                fallback: "Could not remove API key.",
              })
            }
          />
        </>
      }
    >
      {observed.error ? (
        <SettingsLoadFailure
          title="Could not load preferences"
          retrying={observed.loading}
          retry={() => void voiceInputSettings.refresh()}
        />
      ) : !voice ? (
        <SettingsSkeleton label="Loading preferences…">
          <Skeleton className="h-14 w-full rounded-lg" />
        </SettingsSkeleton>
      ) : (
        <SettingsList>
          <Item
            role="listitem"
            data-row
            className={cn(settingsRow, rowActionsWidth.list[voice.hasKey ? 1 : 0], "relative")}
          >
            <ItemContent className="min-w-0">
              <ItemTitle id="voice-input-title">Voice input</ItemTitle>
            </ItemContent>
            {/* As tall as the key menu's button, so saving a key does not move the row. The switch
             * is the row's value: it steps aside beneath the revealed ⋯. */}
            <ItemActions data-motion="aside" className="min-h-8 shrink-0 pointer-coarse:min-h-11">
              <Switch
                size="sm"
                aria-labelledby="voice-input-title"
                checked={voice.enabled}
                disabled={busy}
                onCheckedChange={setEnabled}
              />
            </ItemActions>
            {voice.hasKey && (
              <RowActions className="top-1/2 right-4 -translate-y-1/2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <PianoButton
                      variant="ghost"
                      size="list"
                      aria-label="Voice input actions"
                      disabled={busy}
                    >
                      <MoreHorizontalIcon />
                    </PianoButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => setEditing("replace")}>
                        Replace key
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => actions.confirm("remove-key")}
                    >
                      Remove key
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </RowActions>
            )}
          </Item>
        </SettingsList>
      )}
    </SettingsSectionFrame>
  );
}
