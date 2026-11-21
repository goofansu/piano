import type { OAuthProvider } from "@shared/wire";
import { PlugIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ItemMedia } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiKeySettings } from "@/features/providers/ApiKeySettings";
import { providerLogin } from "@/features/providers/providerApi";
import { providersSettingsView } from "@/features/providers/providersSettingsView";
import { providerAccounts, useProviderAccounts } from "@/features/providers/useProviderAccounts";
import {
  SettingsGroup,
  SettingsList,
  SettingsLoadFailure,
  SettingsSectionFrame,
  SettingsSkeleton,
} from "@/features/settings/SettingsSectionFrame";
import { PianoButton } from "@/shared/components/PianoButton";
import { DropdownMenuItem } from "@/shared/components/PianoDropdownMenu";
import { RemovalDialog, signOutCopy } from "@/shared/components/RemovalDialog";
import { ListRow, RowMenu, RowStatus } from "@/shared/components/RowActions";
import { useSetupActions } from "@/shared/lib/useSetupActions";
import { SignInDialog } from "@/shared/sign-in/SignInDialog";

export function ProvidersSettings({ children }: { children: React.ReactNode }) {
  const observed = useProviderAccounts();
  useEffect(() => void providerAccounts.refresh(), []);
  const actions = useSetupActions<OAuthProvider, string>({
    refresh: () => void providerAccounts.refresh(),
    success: (text) => toast.success(text),
  });
  const { confirmation: signOutTarget, signIn } = actions;
  const signingOut = actions.running;
  const { body, providers } = providersSettingsView({
    value: observed.value,
    failure: !!observed.error,
    signingOut,
  });
  const signOut = (provider: OAuthProvider) =>
    actions.run({
      id: provider.id,
      run: () => providerAccounts.signOut(provider.id),
      done: `Signed out of ${provider.name}`,
      fallback: "Could not sign out. Try again.",
    });
  return (
    <SettingsSectionFrame
      section="providers"
      dialogs={
        <>
          <RemovalDialog
            open={!!signOutTarget}
            busy={!!signingOut}
            cancel={actions.cancel}
            {...signOutCopy(signOutTarget?.name)}
            confirm={() => {
              if (signOutTarget) void signOut(signOutTarget);
            }}
          />
          <SignInDialog
            api={providerLogin}
            signIn={signIn && { key: signIn.key, provider: signIn.subject }}
            providers={providers}
            close={actions.closeSignIn}
            signedIn={() => void providerAccounts.signedIn()}
          />
        </>
      }
    >
      <div className="flex flex-col gap-8">
        {children}
        {body.kind !== "hidden" && (
          <SettingsGroup id="settings-accounts" title="Accounts">
            {body.kind === "error" ? (
              <SettingsLoadFailure
                title="Could not load providers"
                retrying={observed.loading}
                retry={() => void providerAccounts.refresh()}
              />
            ) : body.kind === "loading" ? (
              <SettingsSkeleton label="Loading providers…" className="flex flex-col gap-2">
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} className="h-14 w-full rounded-lg" />
                ))}
              </SettingsSkeleton>
            ) : body.kind === "empty" ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PlugIcon />
                  </EmptyMedia>
                  <EmptyTitle>No OAuth providers available</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <SettingsList>
                {body.rows.map(({ provider, logo, action }) => (
                  <ListRow
                    key={provider.id}
                    media={
                      logo && (
                        <ItemMedia variant="icon">
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <use href={`/provider-logos/${logo}.svg#logo`} />
                          </svg>
                        </ItemMedia>
                      )
                    }
                    title={provider.name}
                    menu={
                      action.intent === "confirm-sign-out" && (
                        <RowMenu
                          label={`${provider.name} account actions`}
                          disabled={!action.enabled}
                        >
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => actions.confirm(provider)}
                          >
                            Sign out
                          </DropdownMenuItem>
                        </RowMenu>
                      )
                    }
                    actions={
                      action.intent !== "confirm-sign-out" && (
                        <PianoButton
                          variant="outline"
                          size="sm"
                          disabled={!action.enabled}
                          aria-label={action.ariaLabel}
                          onClick={() => actions.openSignIn(provider.id)}
                        >
                          {action.label}
                        </PianoButton>
                      )
                    }
                  >
                    {provider.signedIn && <RowStatus>Signed in</RowStatus>}
                  </ListRow>
                ))}
              </SettingsList>
            )}
          </SettingsGroup>
        )}
        <ApiKeySettings />
      </div>
    </SettingsSectionFrame>
  );
}
