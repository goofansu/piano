import type { RadiusAccounts } from "@features/radius/web/radiusSetup";
import { REFRESH_SPIN_MS } from "@features/radius/web/radiusSetup";
import { type RadiusToolView, radiusUninstallCopy } from "@features/radius/web/radiusSetupView";
import { useRadiusSetup } from "@features/radius/web/useRadiusSetup";
import { RefreshCwIcon } from "lucide-react";
import { ItemDescription } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "@/shared/components/IconButton";
import { PianoButton } from "@/shared/components/PianoButton";
import { DropdownMenuItem } from "@/shared/components/PianoDropdownMenu";
import { RemovalDialog, signOutCopy } from "@/shared/components/RemovalDialog";
import { ListRow, RowMenu, RowStatus } from "@/shared/components/RowActions";
import {
  SettingsAlert,
  SettingsExternalLink,
  SettingsGroup,
  SettingsList,
  SettingsSkeleton,
} from "@/shared/components/SettingsSectionFrame";
import type { SignInApi } from "@/shared/sign-in/signInAttempt";
import { SignInDialog } from "@/shared/sign-in/SignInDialog";

export function RadiusSection({
  accounts,
  signIn,
}: {
  accounts: RadiusAccounts;
  signIn: SignInApi;
}) {
  const setup = useRadiusSetup(accounts);
  const { view, confirmation, providers } = setup;
  const { account, mcp, webSearch } = view;
  const removal = confirmation && confirmation.kind !== "sign-out" ? confirmation : undefined;
  return (
    <SettingsGroup
      id="settings-radius"
      title={
        <>
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <use href="/provider-logos/radius.svg#logo" />
          </svg>
          Radius
        </>
      }
      actions={
        <>
          <SettingsExternalLink
            href="https://radius.earendil.com/docs/extensions"
            className="text-sm text-muted-foreground"
          >
            Setup guide
          </SettingsExternalLink>
          <IconButton
            size="header"
            label={setup.refreshing ? "Refreshing setup…" : "Refresh setup"}
            aria-busy={setup.refreshing}
            disabled={!view.canRefresh}
            onClick={setup.refreshByHand}
          >
            <RefreshCwIcon
              className={setup.refreshing ? "animate-spin motion-reduce:animate-none" : undefined}
              style={{ animationDuration: `${REFRESH_SPIN_MS}ms` }}
            />
          </IconButton>
        </>
      }
    >
      {view.attention && (
        <SettingsAlert title="Radius setup needs attention">{view.attention}</SettingsAlert>
      )}
      {!setup.loaded ? (
        <SettingsSkeleton label="Loading Radius setup…" className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </SettingsSkeleton>
      ) : (
        <SettingsList>
          <ListRow
            title="Account"
            menu={
              account.signedIn && (
                <RowMenu label="Radius account actions" disabled={!account.canSignOut}>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setup.confirm({ kind: "sign-out" })}
                  >
                    Sign out
                  </DropdownMenuItem>
                </RowMenu>
              )
            }
            actions={
              !account.signedIn && (
                <PianoButton
                  variant="outline"
                  size="sm"
                  disabled={!account.canSignIn}
                  aria-label="Sign in to Radius"
                  onClick={setup.openSignIn}
                >
                  Sign in
                </PianoButton>
              )
            }
          >
            {account.description && (
              <ItemDescription className="line-clamp-none">{account.description}</ItemDescription>
            )}
            {account.signedIn && <RowStatus>Signed in</RowStatus>}
          </ListRow>
          <RadiusToolRow tool={mcp} setup={setup} />
          <RadiusToolRow tool={webSearch} setup={setup} />
        </SettingsList>
      )}
      {view.installationError && (
        <SettingsAlert title={view.installationError.title}>
          {view.installationError.detail}
        </SettingsAlert>
      )}
      <RemovalDialog
        open={!!confirmation}
        cancel={setup.cancel}
        {...(removal
          ? {
              ...radiusUninstallCopy(removal.kind),
              busy: view.changing,
              disabled: view.locked,
              confirm: setup.confirmRemoval,
            }
          : {
              ...signOutCopy("Radius"),
              busy: account.signingOut,
              confirm: () => void setup.signOut(),
            })}
      />
      <SignInDialog
        api={signIn}
        signIn={setup.signIn && { key: setup.signIn.key, provider: "radius" }}
        providers={providers}
        close={setup.closeSignIn}
        signedIn={setup.signedIn}
      />
    </SettingsGroup>
  );
}

function RadiusToolRow({
  tool,
  setup,
}: {
  tool: RadiusToolView;
  setup: Pick<ReturnType<typeof useRadiusSetup>, "act" | "confirm">;
}) {
  const { install, uninstall, change } = tool;
  const menu = uninstall && (
    <RowMenu label={`${tool.title} actions`} disabled={!uninstall.enabled}>
      <DropdownMenuItem
        variant="destructive"
        aria-label={uninstall.ariaLabel}
        onClick={() => setup.confirm(uninstall.confirmation)}
      >
        {uninstall.label}
      </DropdownMenuItem>
    </RowMenu>
  );
  return (
    <ListRow
      title={tool.title}
      menu={!change && menu}
      actions={
        change ? (
          <PianoButton variant="outline" size="sm" disabled>
            <Spinner data-icon="inline-start" />
            {change.label}
          </PianoButton>
        ) : (
          install && (
            <PianoButton
              variant="outline"
              size="sm"
              disabled={!install.enabled}
              aria-label={install.ariaLabel}
              onClick={() => void setup.act(install.action)}
            >
              {install.label}
            </PianoButton>
          )
        )
      }
    >
      {tool.detail && <ItemDescription className="line-clamp-none">{tool.detail}</ItemDescription>}
      {tool.ready && <RowStatus>{tool.readyLabel}</RowStatus>}
    </ListRow>
  );
}
