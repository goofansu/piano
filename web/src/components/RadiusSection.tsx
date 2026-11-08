import { RefreshCwIcon } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { PianoButton } from "@/components/PianoButton";
import { DropdownMenuItem } from "@/components/PianoDropdownMenu";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { RemovalDialog, signOutCopy } from "@/components/RemovalDialog";
import { ListRow, RowMenu, RowStatus } from "@/components/RowActions";
import {
  SettingsAlert,
  SettingsExternalLink,
  SettingsGroup,
  SettingsList,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { ItemDescription } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { REFRESH_SPIN_MS } from "@/lib/radiusSetup";
import { type RadiusToolView, radiusUninstallCopy } from "@/lib/radiusSetupView";
import { useRadiusSetup } from "@/lib/useRadiusSetup";

/**
 * Radius on the Providers page: the account, and what Pi may use from it. Radius is here rather
 * than in the provider list because signing in is only the first of its steps.
 */
export function RadiusSection() {
  const setup = useRadiusSetup();
  const { view, confirmation, providers } = setup;
  const { account, mcp, webSearch } = view;
  const removal = confirmation && confirmation.kind !== "sign-out" ? confirmation : undefined;
  return (
    <div>
      <SettingsGroup
        id="settings-radius"
        title={
          <>
            <svg
              className="size-4 shrink-0"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
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
                      onSelect={() => setup.confirm({ kind: "sign-out" })}
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
        <ProviderLoginDialog
          signIn={setup.signIn && { key: setup.signIn.key, provider: "radius" }}
          providers={providers}
          close={setup.closeSignIn}
          signedIn={setup.signedIn}
        />
      </SettingsGroup>
    </div>
  );
}

/** One tool's row: its wording, its install and uninstall actions, or the change Pi is running. */
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
        onSelect={() => setup.confirm(uninstall.confirmation)}
      >
        {uninstall.label}
      </DropdownMenuItem>
    </RowMenu>
  );
  // The menu reveals over the row's end, unless Install already stands there: then it sits beside
  // it. While Pi runs a change, the change stands alone.
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
