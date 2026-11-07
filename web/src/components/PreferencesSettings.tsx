import type { VoiceInputState } from "@shared/voiceInput";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { saveVoiceInput, voiceInput } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

/** Why the key dialog is open: turning voice input on, or replacing the saved key. */
type KeyEditing = "turn-on" | "replace";

export function PreferencesSettings() {
  const observed = useObservation("voice-input", (signal) => voiceInput({ signal }));
  const [editing, setEditing] = useState<KeyEditing>();
  const actions = useSetupActions<"remove-key">({
    refresh: () => void observed.refresh(),
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
      run: () => saveVoiceInput({ enabled }),
      done: enabled ? "Voice input on" : "Voice input off",
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
            <OpenAiKeyEditor
              voice={voice}
              editing={editing}
              close={() => setEditing(undefined)}
              refresh={() => void observed.refresh()}
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
                run: () => saveVoiceInput({ enabled: false, key: null }),
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
          retry={() => void observed.refresh()}
        />
      ) : !voice ? (
        <SettingsSkeleton label="Loading preferences…">
          <Skeleton className="h-14 w-full rounded-lg" />
        </SettingsSkeleton>
      ) : (
        <SettingsList>
          <Item role="listitem" className={settingsRow}>
            <ItemContent className="min-w-0">
              <ItemTitle id="voice-input-title">Voice input</ItemTitle>
            </ItemContent>
            {/* As tall as the key menu's button, so saving a key does not move the row. */}
            <ItemActions className="min-h-8 shrink-0 gap-1 pointer-coarse:min-h-11">
              <Switch
                size="sm"
                aria-labelledby="voice-input-title"
                checked={voice.enabled}
                disabled={busy}
                onCheckedChange={setEnabled}
              />
              {voice.hasKey && (
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
              )}
            </ItemActions>
          </Item>
        </SettingsList>
      )}
    </SettingsSectionFrame>
  );
}

function OpenAiKeyEditor({
  voice,
  editing,
  close,
  refresh,
}: {
  voice: VoiceInputState;
  editing: KeyEditing;
  close: () => void;
  refresh: () => void;
}) {
  // Never load the old key, retain it outside this dialog, or put it in browser storage.
  const [key, setKey] = useState("");
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  const turningOn = editing === "turn-on";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>OpenAI API key</DialogTitle>
          <DialogDescription>
            Voice input sends recordings and session context to OpenAI.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !key.trim()) return;
            void actions.run({
              id: "save-key",
              run: async () => {
                await saveVoiceInput({ enabled: turningOn || voice.enabled, key: key.trim() });
                setKey("");
                close();
              },
              done: turningOn ? "Voice input on" : "OpenAI API key saved",
              fallback: "Could not save API key.",
            });
          }}
        >
          <FieldGroup>
            <Field data-disabled={busy} data-invalid={!!actions.error || undefined}>
              <FieldLabel htmlFor="openai-api-key">API key</FieldLabel>
              <Input
                id="openai-api-key"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                autoCapitalize="none"
                maxLength={8192}
                required
                disabled={busy}
                aria-invalid={!!actions.error || undefined}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              {actions.error && <FieldError role="alert">{actions.error}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !key.trim()}>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
