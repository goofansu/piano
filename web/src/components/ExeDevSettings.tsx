import type { NotificationAction } from "@shared/notifications";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/PianoSelect";
import {
  SettingsAlert,
  SettingsSectionFrame,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { changeExeDevSettings } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

export function ExeDevSettings() {
  // Page entry, focus and Retry explicitly refresh inventory, independently of sticky detection.
  const observed = useObservation(
    "exe-dev",
    (signal) => changeExeDevSettings({ action: "refresh" }, { signal }),
    { focus: true },
  );
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const [busy, setBusy] = useState(false);
  const value = observed.value;
  const names = observed.failure ? null : value?.integrations;
  const selected = value?.selected ?? null;
  const missing = !!selected && names != null && !names.includes(selected);
  const change = async (action: NotificationAction) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      await observed.mutate((signal) => changeExeDevSettings(action, { signal }));
      if (action.action === "test") setResult("Test notification accepted.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not change notifications.");
      await observed.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSectionFrame title="exe.dev" sectionId="settings-exe-dev">
      <section aria-labelledby="exe-dev-notifications" className="flex flex-col gap-3">
        <h2 id="exe-dev-notifications" className="text-lg font-semibold">
          Notifications
        </h2>
        {!value && !observed.failure ? (
          <SettingsSkeleton label="Loading integrations…">
            <Skeleton className="h-9 w-full" />
          </SettingsSkeleton>
        ) : (
          <>
            {value?.problem && (
              <SettingsAlert title="Configure Piano’s public URL">{value.problem}</SettingsAlert>
            )}
            <FieldGroup>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="slack-integration">Slack integration</FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={selected ?? ""}
                    disabled={busy || !names?.length || !!value?.problem}
                    onValueChange={(name) => void change({ action: "select", name })}
                  >
                    <SelectTrigger
                      id="slack-integration"
                      className="min-w-0 flex-1"
                      aria-invalid={!!error}
                      aria-describedby={error ? "integration-error" : undefined}
                    >
                      <SelectValue
                        placeholder={
                          names?.length === 0 ? "No Slack integrations" : "Select integration"
                        }
                      >
                        {selected ? `${selected}${missing ? " (unavailable)" : ""}` : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {names?.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {selected && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void change({ action: "select", name: null })}
                    >
                      Clear
                    </Button>
                  )}
                  {selected && (
                    <Button
                      variant="outline"
                      disabled={busy || !names?.includes(selected) || !!value?.problem}
                      onClick={() => void change({ action: "test" })}
                    >
                      Test
                    </Button>
                  )}
                </div>
                {error && <FieldError id="integration-error">{error}</FieldError>}
              </Field>
            </FieldGroup>
            {names == null ? (
              <SettingsAlert title="Couldn’t load integrations">
                <Button
                  variant="outline"
                  disabled={busy || observed.loading}
                  onClick={() => void observed.refresh()}
                >
                  Retry
                </Button>
              </SettingsAlert>
            ) : (
              (names.length === 0 || missing) && (
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <a href="https://exe.dev/integrations" target="_blank" rel="noreferrer">
                      Manage integrations
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || observed.loading}
                    onClick={() => void observed.refresh()}
                  >
                    Refresh
                  </Button>
                </div>
              )
            )}
            {result && <p role="status">{result}</p>}
          </>
        )}
      </section>
    </SettingsSectionFrame>
  );
}
