import type { ApiKeyProvider } from "@shared/providerApiKeys";
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
  SettingsGroup,
  SettingsList,
  SettingsLoadFailure,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { StatusDot } from "@/components/StatusDot";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { changeProviderApiKey, providerApiKeys } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

export function ApiKeySettings() {
  const observed = useObservation("provider-api-keys", (signal) => providerApiKeys({ signal }));
  const [editing, setEditing] = useState<ApiKeyProvider>();
  const actions = useSetupActions<ApiKeyProvider>({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
  });
  const removing = actions.confirmation;
  const busy = actions.running !== undefined;
  return (
    <SettingsGroup id="settings-api-keys" title="API keys">
      {observed.error ? (
        <SettingsLoadFailure
          title="Could not load API keys"
          retrying={observed.loading}
          retry={() => void observed.refresh()}
        />
      ) : !observed.value ? (
        <SettingsSkeleton label="Loading API keys…" className="flex flex-col gap-2">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-14 w-full rounded-lg" />
          ))}
        </SettingsSkeleton>
      ) : (
        <SettingsList>
          {observed.value.map((provider) => (
            <Item
              key={provider.id}
              role="listitem"
              data-row
              className={cn(settingsRow, "relative", rowActionsWidth.list[provider.saved ? 1 : 0])}
            >
              <ItemMedia variant="icon">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <use href={`/provider-logos/${provider.logo}.svg#logo`} />
                </svg>
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>{provider.name}</ItemTitle>
              </ItemContent>
              {provider.saved ? (
                <>
                  <ItemActions
                    data-motion="aside"
                    className="shrink-0 gap-1.5 text-muted-foreground"
                  >
                    <StatusDot tone="ok" />
                    <span className="text-sm">Saved</span>
                  </ItemActions>
                  <RowActions className="right-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <PianoButton
                          variant="ghost"
                          size="list"
                          aria-label={`${provider.name} API key actions`}
                          disabled={busy}
                        >
                          <MoreHorizontalIcon />
                        </PianoButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onSelect={() => setEditing(provider)}>
                            Replace key
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => actions.confirm(provider)}
                        >
                          Remove key
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </RowActions>
                </>
              ) : (
                <ItemActions>
                  <PianoButton
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Add ${provider.name} API key`}
                    onClick={() => setEditing(provider)}
                  >
                    Add key
                  </PianoButton>
                </ItemActions>
              )}
            </Item>
          ))}
        </SettingsList>
      )}
      {editing && (
        <ApiKeyDialog
          title={`${editing.saved ? "Replace" : "Add"} ${editing.name} API key`}
          description="Saved in Pi on this machine. Start a new session to use it."
          save={(key) => changeProviderApiKey({ action: "save", provider: editing.id, key })}
          done={`${editing.name} API key saved`}
          fallback="Could not save API key."
          close={() => setEditing(undefined)}
          refresh={() => void observed.refresh()}
        />
      )}
      <RemovalDialog
        open={!!removing}
        title={`Remove ${removing?.name} API key?`}
        description="Removes the saved key from Pi on this machine, without revoking it at the provider. Environment keys still apply."
        action="Remove key"
        progress="Removing…"
        busy={busy}
        cancel={actions.cancel}
        confirm={() => {
          if (!removing) return;
          void actions.run({
            id: removing.id,
            run: () => changeProviderApiKey({ action: "remove", provider: removing.id }),
            done: `${removing.name} API key removed`,
            fallback: "Could not remove API key.",
          });
        }}
      />
    </SettingsGroup>
  );
}
