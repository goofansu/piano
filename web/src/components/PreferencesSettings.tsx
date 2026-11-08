import { useState } from "react";
import { toast } from "sonner";
import { ApiKeyDialog } from "@/components/ApiKeyDialog";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/PianoDropdownMenu";
import { RemovalDialog } from "@/components/RemovalDialog";
import { ListRow, RowMenu } from "@/components/RowActions";
import {
  SettingsList,
  SettingsLoadState,
  SettingsSectionFrame,
} from "@/components/SettingsSectionFrame";
import { Switch } from "@/components/ui/switch";
import { settingsLoadView } from "@/lib/settingsLoadView";
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
      <SettingsLoadState
        view={settingsLoadView(observed)}
        noun="preferences"
        retry={() => void voiceInputSettings.refresh()}
        skeletonRows={1}
      >
        {(voice) => (
          <SettingsList>
            <ListRow
              title="Voice input"
              titleId="voice-input-title"
              actions={
                // Keep the switch beside the key menu, never beneath its revealed hit target.
                // Match the menu's height so saving a key does not move the row vertically.
                <span className="flex min-h-8 items-center pointer-coarse:min-h-11">
                  <Switch
                    size="sm"
                    aria-labelledby="voice-input-title"
                    checked={voice.enabled}
                    disabled={busy}
                    onCheckedChange={setEnabled}
                  />
                </span>
              }
              menu={
                voice.hasKey && (
                  <RowMenu label="Voice input actions" disabled={busy}>
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
                  </RowMenu>
                )
              }
            />
          </SettingsList>
        )}
      </SettingsLoadState>
    </SettingsSectionFrame>
  );
}
