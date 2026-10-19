import type { NotificationAction } from "@shared/notifications";
import { CheckCircle2Icon } from "lucide-react";
import { useId } from "react";
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
import { type IntegrationsReady, integrationsView } from "@/lib/integrationsView";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

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
  const actions = useSetupActions({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
  });
  const busy = actions.running !== undefined;
  const view = integrationsView({
    settings: observed.value,
    loadFailed: !!observed.failure,
    busy,
  });
  const change = (action: NotificationAction) =>
    void actions.run({
      id: action.action,
      run: () => observed.mutate((signal) => changeIntegrationsSettings(action, { signal })),
      done: action.action === "test" ? "Test notification accepted." : undefined,
      fallback: "Could not change notifications.",
    });
  const refresh = (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      disabled={busy || observed.loading}
      onClick={() => void observed.refresh()}
    >
      Refresh
    </Button>
  );
  return (
    <SettingsSectionFrame title="Integrations" sectionId="settings-integrations">
      <p className="text-sm text-muted-foreground">
        Piano uses the integrations attached to this VM on exe.dev.{" "}
        <SettingsExternalLink href={MANAGE_INTEGRATIONS} className="text-foreground underline">
          Manage integrations on exe.dev
        </SettingsExternalLink>
      </p>
      {view.status !== "loading" && view.problem && (
        <SettingsAlert title="Configure Piano’s public URL">{view.problem}</SettingsAlert>
      )}
      {actions.error && (
        <SettingsAlert title="Notifications need attention">{actions.error}</SettingsAlert>
      )}
      {view.status === "unavailable" && (
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
      {view.status === "loading" ? (
        <SettingsSkeleton label="Loading integrations…">
          <Skeleton className="h-28 w-full rounded-xl" />
        </SettingsSkeleton>
      ) : (
        <Item variant="outline" className="rounded-xl px-4 sm:px-5">
          <ItemContent className="min-w-0">
            <ItemTitle>
              Slack
              {view.on && (
                <>
                  <CheckCircle2Icon className="size-3.5 text-brand" aria-hidden />
                  <span className="sr-only">(On)</span>
                </>
              )}
            </ItemTitle>
            <ItemDescription>Sends a message when an agent finishes responding.</ItemDescription>
          </ItemContent>
          <ItemActions className="shrink-0">
            {view.on && (
              <Button
                variant="outline"
                size="sm"
                disabled={view.testDisabled}
                onClick={() => change({ action: "test" })}
              >
                Test
              </Button>
            )}
            {view.refresh && refresh}
          </ItemActions>
          <WebhookChoice view={view} choose={(name) => change({ action: "select", name })} />
        </Item>
      )}
    </SettingsSectionFrame>
  );
}

function WebhookChoice({
  view,
  choose,
}: {
  view: IntegrationsReady;
  choose: (name: string | null) => void;
}) {
  const id = useId();
  const option = (key: string, value: string, label: React.ReactNode, disabled: boolean) => (
    <Field key={key} orientation="horizontal">
      <RadioGroupItem id={`${id}-${key}`} value={value} disabled={disabled} />
      <FieldLabel htmlFor={`${id}-${key}`} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
  );
  return (
    <RadioGroup
      aria-label="Slack webhook"
      className="basis-full gap-2"
      value={view.checked ?? OFF}
      onValueChange={(value) => choose(value === OFF ? null : value)}
    >
      {option("off", OFF, "Off", view.offDisabled)}
      {view.options.map(({ name, notAttached, disabled }) =>
        option(
          notAttached ? `${name}-missing` : name,
          name,
          notAttached ? (
            <>
              {name} <span className="text-muted-foreground">(not attached)</span>
            </>
          ) : (
            name
          ),
          disabled,
        ),
      )}
      {view.noWebhooks && (
        <p className="text-sm text-muted-foreground">No webhooks attached to this VM.</p>
      )}
    </RadioGroup>
  );
}
