import type { NotificationAction } from "@shared/notifications";
import { CheckCircle2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/PianoSelect";
import {
  SettingsAlert,
  SettingsExternalLink,
  SettingsSectionFrame,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { changeIntegrationsSettings } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

const MANAGE_INTEGRATIONS = "https://exe.dev/integrations";
/** Radix Select cannot hold an empty value, so "Off" is a sentinel that never leaves this file. */
const OFF = "\u0000off";

/**
 * Piano's use of the integrations attached to this VM on exe.dev. Slack is one row: the dropdown
 * picks which attached Slack webhook receives completion notifications, or Off.
 */
export function IntegrationsSettings() {
  // Page entry, focus and Retry explicitly refresh inventory, independently of sticky detection.
  const observed = useObservation(
    "integrations",
    (signal) => changeIntegrationsSettings({ action: "refresh" }, { signal }),
    { focus: true },
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const value = observed.value;
  const loading = !value && !observed.failure;
  const names = observed.failure ? null : value?.integrations;
  const failed = !loading && names == null;
  const selected = value?.selected ?? null;
  const missing = !!selected && names != null && !names.includes(selected);
  const problem = value?.problem;
  // Nothing to choose and nothing to turn off: the only state is already shown.
  const nothing = names?.length === 0 && !selected;
  const change = async (action: NotificationAction) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await observed.mutate((signal) => changeIntegrationsSettings(action, { signal }));
      if (action.action === "test") toast.success("Test notification accepted.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not change notifications.");
      await observed.refresh();
    } finally {
      setBusy(false);
    }
  };
  const label = missing
    ? `${selected} (not attached)`
    : (selected ?? (nothing ? "No webhooks" : "Off"));
  return (
    <SettingsSectionFrame title="Integrations" sectionId="settings-integrations">
      <p className="text-sm text-muted-foreground">
        Piano uses the integrations attached to this VM on exe.dev.{" "}
        <SettingsExternalLink href={MANAGE_INTEGRATIONS} className="text-foreground underline">
          Manage integrations on exe.dev
        </SettingsExternalLink>
      </p>
      {problem && <SettingsAlert title="Configure Piano’s public URL">{problem}</SettingsAlert>}
      {error && <SettingsAlert title="Notifications need attention">{error}</SettingsAlert>}
      {failed && (
        <SettingsAlert title="Couldn’t load integrations">
          <p>Check the exe.dev Reflection integration and try again.</p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || observed.loading}
            onClick={() => void observed.refresh()}
          >
            Retry
          </Button>
        </SettingsAlert>
      )}
      {loading ? (
        <SettingsSkeleton label="Loading integrations…">
          <Skeleton className="h-16 w-full rounded-xl" />
        </SettingsSkeleton>
      ) : (
        <Item variant="outline" className="rounded-xl px-4 sm:px-5">
          {/* Content keeps a readable width, so on a phone the controls wrap below it. */}
          <ItemContent className="min-w-0 basis-64">
            <ItemTitle>
              Slack
              {selected && !missing && (
                <>
                  <CheckCircle2Icon className="size-3.5 text-brand" aria-hidden />
                  <span className="sr-only">(On)</span>
                </>
              )}
            </ItemTitle>
            <ItemDescription>Sends a message when an agent finishes responding.</ItemDescription>
          </ItemContent>
          <ItemActions className="shrink-0">
            <ButtonGroup>
              {/* Off stays reachable through discovery failures and a missing public URL; only
                  choosing a webhook waits for both. */}
              <Select
                value={selected ?? OFF}
                disabled={busy || nothing}
                onValueChange={(name) =>
                  void change({ action: "select", name: name === OFF ? null : name })
                }
              >
                <SelectTrigger size="sm" className="min-w-36" aria-label="Slack webhook">
                  <SelectValue>{label}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value={OFF}>Off</SelectItem>
                  {(missing || !!names?.length) && <SelectSeparator />}
                  <SelectGroup>
                    {missing && (
                      <SelectItem value={selected} disabled>
                        {selected} (not attached)
                      </SelectItem>
                    )}
                    {names?.map((name) => (
                      <SelectItem key={name} value={name} disabled={!!problem}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {selected && !missing && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !!problem}
                  onClick={() => void change({ action: "test" })}
                >
                  Test
                </Button>
              )}
            </ButtonGroup>
            {(nothing || missing) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={busy || observed.loading}
                onClick={() => void observed.refresh()}
              >
                Refresh
              </Button>
            )}
          </ItemActions>
        </Item>
      )}
    </SettingsSectionFrame>
  );
}
