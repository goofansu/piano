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
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { changeNotifications } from "@/lib/api";
import { useNotifications } from "@/lib/useNotifications";

export function NotificationSettings() {
  const observed = useNotifications();
  const [url, setUrl] = useState("");
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
      if (action.action === "add") setUrl("");
      if (action.action === "test")
        setResult("Test notification accepted. Check your Slack channel.");
    } catch (error) {
      setInvalid(action.action === "add");
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
              void change({ action: "add", url });
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
                      setUrl(event.target.value);
                      setError(undefined);
                      setInvalid(false);
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="submit"
                      disabled={busy || !url.trim() || !!observed.value.problem}
                    >
                      Add
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
          <ItemGroup className="gap-2" aria-label="Slack webhooks">
            {observed.value.webhooks.map((saved) => (
              <Item key={saved} variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle className="min-w-0 max-w-full">
                    <span className="truncate" title={saved}>
                      {saved}
                    </span>
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !!observed.value?.problem}
                    aria-label={`Test ${saved}`}
                    onClick={() => void change({ action: "test", url: saved })}
                  >
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${saved}`}
                    onClick={() => void change({ action: "remove", url: saved })}
                  >
                    Remove
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
          {result && <p role="status">{result}</p>}
        </>
      )}
    </SettingsSectionFrame>
  );
}
