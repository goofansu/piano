import type { NotificationAction } from "@shared/notifications";
import { CheckCircle2Icon, PlugIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  SettingsAlert,
  SettingsExternalLink,
  SettingsSectionFrame,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { changeIntegrationsSettings } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

const MANAGE_INTEGRATIONS = "https://exe.dev/integrations";

/**
 * Piano's use of the integrations attached to this VM on exe.dev, laid out as exe.dev's dashboard
 * words them: a "Send messages" section with one row per integration, named and typed as exe.dev
 * names it. The catalog holds Slack today; the selected integration receives completion notifications.
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
  const names = observed.failure ? null : value?.integrations;
  const selected = value?.selected ?? null;
  const missing = !!selected && names != null && !names.includes(selected);
  // A saved name no longer attached keeps a row, so it stays visible and clearable.
  const rows = names == null ? [] : missing ? [selected, ...names] : names;
  const blocked = busy || !!value?.problem;
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
      <section aria-labelledby="settings-send-messages-title" className="flex flex-col gap-3">
        <h2
          id="settings-send-messages-title"
          className="flex min-h-8 items-center text-lg font-semibold"
        >
          Send messages
        </h2>
        {value?.problem && (
          <SettingsAlert title="Configure Piano’s public URL">{value.problem}</SettingsAlert>
        )}
        {error && <SettingsAlert title="Notifications need attention">{error}</SettingsAlert>}
        {!value && !observed.failure ? (
          <SettingsSkeleton label="Loading integrations…">
            <Skeleton className="h-16 w-full rounded-xl" />
          </SettingsSkeleton>
        ) : names == null ? (
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
        ) : rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugIcon />
              </EmptyMedia>
              <EmptyTitle>No Slack integrations</EmptyTitle>
              <EmptyDescription>Attach one to this VM on exe.dev, then refresh.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || observed.loading}
                onClick={() => void observed.refresh()}
              >
                Refresh
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {rows.map((name) => (
              <IntegrationItem
                key={name}
                name={name}
                selected={name === selected}
                attached={names.includes(name)}
                busy={busy}
                blocked={blocked}
                select={() => void change({ action: "select", name })}
                clear={() => void change({ action: "select", name: null })}
                test={() => void change({ action: "test" })}
              />
            ))}
          </ItemGroup>
        )}
      </section>
    </SettingsSectionFrame>
  );
}

function IntegrationItem({
  name,
  selected,
  attached,
  busy,
  blocked,
  select,
  clear,
  test,
}: {
  name: string;
  selected: boolean;
  /** False for a saved name the current catalog no longer lists. */
  attached: boolean;
  busy: boolean;
  /** Selecting and testing wait for a public URL; clearing never does. */
  blocked: boolean;
  select: () => void;
  clear: () => void;
  test: () => void;
}) {
  // Slack's logo left Simple Icons, so the row has no media, like MCP servers without a logo.
  return (
    <Item role="listitem" variant="outline" className="flex-nowrap rounded-xl px-4 sm:px-5">
      <ItemContent className="min-w-0">
        <ItemTitle>
          {name}
          {selected && (
            <>
              <CheckCircle2Icon className="size-3.5 text-brand" aria-hidden />
              <span className="sr-only">(Selected)</span>
            </>
          )}
        </ItemTitle>
        {/* The catalog is Slack-only; the type joins the wire when another type is supported. */}
        <ItemDescription>{attached ? "Slack" : "Not attached to this VM"}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        {selected ? (
          <>
            {attached && (
              <Button
                variant="outline"
                size="sm"
                disabled={blocked}
                aria-label={`Test ${name}`}
                onClick={test}
              >
                Test
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={busy}
              aria-label={`Clear ${name}`}
              onClick={clear}
            >
              Clear
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={blocked} aria-label={`Select ${name}`} onClick={select}>
            Select
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}
