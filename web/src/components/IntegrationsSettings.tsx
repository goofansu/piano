import type { NotificationAction } from "@shared/notifications";
import { CheckCircle2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  SettingsAlert,
  SettingsExternalLink,
  SettingsSectionFrame,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { changeIntegrationsSettings } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

const MANAGE_INTEGRATIONS = "https://exe.dev/integrations";
/** The radio group needs a value for "no webhook"; this sentinel never leaves this file. */
const OFF = "\u0000off";

/**
 * Piano's use of the integrations attached to this VM on exe.dev. Slack is one card: radios pick
 * which attached Slack webhook receives completion notifications, or Off.
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
          <Skeleton className="h-28 w-full rounded-xl" />
        </SettingsSkeleton>
      ) : (
        <Item variant="outline" className="rounded-xl px-4 sm:px-5">
          <ItemContent className="min-w-0">
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
          {/* Off stays reachable through discovery failures and a missing public URL; only
              choosing a webhook waits for both. */}
          <WebhookChoice
            names={names ?? []}
            selected={selected}
            missing={missing}
            disabled={busy}
            webhooksDisabled={busy || !!problem}
            choose={(name) => void change({ action: "select", name })}
          />
        </Item>
      )}
    </SettingsSectionFrame>
  );
}

function WebhookChoice({
  names,
  selected,
  missing,
  disabled,
  webhooksDisabled,
  choose,
}: {
  names: readonly string[];
  selected: string | null;
  /** The saved name is not in the current catalog: shown checked but unpickable. */
  missing: boolean;
  disabled: boolean;
  webhooksDisabled: boolean;
  choose: (name: string | null) => void;
}) {
  const id = useId();
  const option = (value: string, label: string, off = false) => (
    <Field key={value} orientation="horizontal">
      <RadioGroupItem
        id={`${id}-${value}`}
        value={value}
        disabled={off ? disabled : webhooksDisabled || off}
      />
      <FieldLabel htmlFor={`${id}-${value}`} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
  );
  return (
    <RadioGroup
      aria-label="Slack webhook"
      className="basis-full gap-2"
      value={selected ?? OFF}
      onValueChange={(value) => choose(value === OFF ? null : value)}
    >
      {option(OFF, "Off", true)}
      {missing && selected && (
        <Field key={selected} orientation="horizontal">
          <RadioGroupItem id={`${id}-missing`} value={selected} disabled />
          <FieldLabel htmlFor={`${id}-missing`} className="font-normal">
            {selected} <span className="text-muted-foreground">(not attached)</span>
          </FieldLabel>
        </Field>
      )}
      {names.map((name) => option(name, name))}
      {names.length === 0 && !missing && (
        <p className="text-sm text-muted-foreground">No webhooks attached to this VM.</p>
      )}
    </RadioGroup>
  );
}
