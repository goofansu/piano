import type { ApiKeyProvider } from "@shared/providerApiKeys";
import { cn } from "cn";
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
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import {
  SettingsGroup,
  SettingsList,
  SettingsLoadFailure,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
    <SettingsGroup id="settings-api-keys" title="API Keys">
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Add ${provider.name} API key`}
                    onClick={() => setEditing(provider)}
                  >
                    Add key
                  </Button>
                </ItemActions>
              )}
            </Item>
          ))}
        </SettingsList>
      )}
      {editing && (
        <ApiKeyEditor
          provider={editing}
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

function ApiKeyEditor({
  provider,
  close,
  refresh,
}: {
  provider: ApiKeyProvider;
  close: () => void;
  refresh: () => void;
}) {
  // Never load the old key, retain it outside this dialog, or put it in browser storage.
  const [key, setKey] = useState("");
  const actions = useSetupActions({ refresh, success: (text) => toast.success(text) });
  const busy = actions.running !== undefined;
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
          <DialogTitle>{provider.name} API key</DialogTitle>
          <DialogDescription>
            Saved in Pi on this machine. Start a new session to use it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !key.trim()) return;
            void actions.run({
              id: provider.id,
              run: async () => {
                await changeProviderApiKey({
                  action: "save",
                  provider: provider.id,
                  key: key.trim(),
                });
                setKey("");
                close();
              },
              done: `${provider.name} API key saved`,
              fallback: "Could not save API key.",
            });
          }}
        >
          <FieldGroup>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="provider-api-key">API key</FieldLabel>
              <Input
                id="provider-api-key"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                autoCapitalize="none"
                maxLength={8192}
                required
                disabled={busy}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
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
