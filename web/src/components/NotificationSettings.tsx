import type { NotificationAction } from "@shared/notifications";
import { useEffect, useState } from "react";
import {
  SettingsAlert,
  SettingsSectionFrame,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { changeNotifications } from "@/lib/api";
import { useNotifications } from "@/lib/useNotifications";

export function NotificationSettings() {
  const observed = useNotifications();
  const [draft, setDraft] = useState<string>();
  const saved = observed.value?.webhook ?? "";
  const url = draft ?? saved;
  const changed = url.trim() !== saved;
  const [error, setError] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const [result, setResult] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { refresh } = observed;
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const change = async (action: NotificationAction) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setInvalid(false);
    setResult(undefined);
    try {
      await observed.mutate((signal) => changeNotifications(action, { signal }));
      if (action.action !== "test") {
        setDraft(undefined);
        setResult(
          action.action === "save" ? "Slack webhook saved." : "Slack notifications removed.",
        );
      }
      if (action.action === "test")
        setResult("Test notification accepted. Check your Slack channel.");
    } catch (error) {
      setInvalid(action.action === "save");
      setError(error instanceof Error ? error.message : "Could not change notifications.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSectionFrame title="Notifications" sectionId="settings-notifications">
      {!observed.value && !observed.failure ? (
        <SettingsSkeleton label="Checking notification availability…">
          <Skeleton className="h-24 w-full" />
        </SettingsSkeleton>
      ) : !observed.value?.detected ? (
        <SettingsAlert title="Notifications require exe.dev">
          <p>{observed.failure ?? "Piano could not detect an exe.dev environment."}</p>
          <Button variant="outline" disabled={observed.loading} onClick={() => void refresh()}>
            Retry
          </Button>
        </SettingsAlert>
      ) : (
        <>
          {observed.value.problem && (
            <SettingsAlert title="Configure Piano’s public URL">
              {observed.value.problem}
            </SettingsAlert>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void change({ action: "save", url });
            }}
          >
            <FieldGroup>
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="notification-url">Slack webhook URL</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="notification-url"
                    type="url"
                    required
                    value={url}
                    disabled={busy}
                    aria-invalid={invalid}
                    aria-describedby={
                      invalid
                        ? "notification-description notification-error"
                        : "notification-description"
                    }
                    placeholder="https://slack-hook.int.exe.xyz/"
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setResult(undefined);
                      setError(undefined);
                      setInvalid(false);
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="submit"
                      disabled={busy || !url.trim() || !changed || !!observed.value.problem}
                    >
                      Save
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription id="notification-description">
                  Notify Slack when an agent finishes responding, even with your browser closed. Use
                  a Slack integration attached to this exe.dev VM.
                </FieldDescription>
                {invalid && error && <FieldError id="notification-error">{error}</FieldError>}
              </Field>
            </FieldGroup>
          </form>
          {error && !invalid && (
            <SettingsAlert title="Notification needs attention">{error}</SettingsAlert>
          )}
          {saved && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy || changed || !!observed.value.problem}
                onClick={() => void change({ action: "test" })}
              >
                Test
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void change({ action: "remove" })}
              >
                Remove
              </Button>
            </div>
          )}
          {result && <p role="status">{result}</p>}
        </>
      )}
    </SettingsSectionFrame>
  );
}
