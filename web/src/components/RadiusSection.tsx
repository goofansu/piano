import { CheckCircle2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "@/components/IconButton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { RemovalDialog, signOutCopy } from "@/components/RemovalDialog";
import {
  SettingsAlert,
  SettingsExternalLink,
  SettingsGroup,
  SettingsList,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { REFRESH_SPIN_MS } from "@/lib/radiusSetup";
import { type RadiusToolView, radiusUninstallCopy } from "@/lib/radiusSetupView";
import { useRadiusSetup } from "@/lib/useRadiusSetup";

/**
 * Radius on the Providers page: the account, and what Pi may use from it. Radius is here rather
 * than in the provider list because signing in is only the first of its steps.
 *
 * `reveal` is navigation's request count for the address and palette row that name Radius
 * directly: each new request scrolls to this first section. Counting requests rather than reading
 * a flag lets the same row asked for twice reveal Radius twice.
 */
export function RadiusSection({ reveal }: { reveal?: number }) {
  const setup = useRadiusSetup();
  const { view, confirmation, providers } = setup;
  const { account, mcp, webSearch } = view;
  const removal = confirmation && confirmation.kind !== "sign-out" ? confirmation : undefined;
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal === undefined) return;
    // Radius is first, so its position no longer depends on the provider catalog loading.
    anchor.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [reveal]);
  return (
    <div id="settings-radius" ref={anchor} className="scroll-mt-4">
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
            <Item className={settingsRow}>
              <ItemContent className="min-w-0">
                <ItemTitle>
                  Account
                  <ReadyMark ready={account.signedIn} label="Signed in" />
                </ItemTitle>
                {account.description && (
                  <ItemDescription className="line-clamp-none">
                    {account.description}
                  </ItemDescription>
                )}
              </ItemContent>
              <ItemActions>
                {account.signedIn ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    disabled={!account.canSignOut}
                    aria-label="Sign out of Radius"
                    onClick={() => setup.confirm({ kind: "sign-out" })}
                  >
                    {account.signingOut && <Spinner data-icon="inline-start" />}
                    {account.signingOut ? "Signing out…" : "Sign out"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!account.canSignIn}
                    aria-label="Sign in to Radius"
                    onClick={setup.openSignIn}
                  >
                    Sign in
                  </Button>
                )}
              </ItemActions>
            </Item>
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
  return (
    <Item className={settingsRow}>
      <ItemContent className="min-w-0">
        <ItemTitle>
          {tool.title}
          <ReadyMark ready={tool.ready} label={tool.readyLabel} />
        </ItemTitle>
        {tool.detail && (
          <ItemDescription className="line-clamp-none">{tool.detail}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        {change ? (
          <Button variant={change.action === "uninstall" ? "ghost" : "outline"} size="sm" disabled>
            <Spinner data-icon="inline-start" />
            {change.label}
          </Button>
        ) : (
          <>
            {install && (
              <Button
                variant="outline"
                size="sm"
                disabled={!install.enabled}
                aria-label={install.ariaLabel}
                onClick={() => void setup.act(install.action)}
              >
                {install.label}
              </Button>
            )}
            {uninstall && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={!uninstall.enabled}
                onClick={() => setup.confirm(uninstall.confirmation)}
                aria-label={uninstall.ariaLabel}
              >
                {uninstall.label}
              </Button>
            )}
          </>
        )}
      </ItemActions>
    </Item>
  );
}

/** A quiet check beside a title once that part is ready; screen readers hear the label. */
function ReadyMark({ ready, label }: { ready: boolean; label: string }) {
  if (!ready) return null;
  return (
    <>
      <CheckCircle2Icon className="size-3.5 text-brand" aria-hidden />
      <span className="sr-only">({label})</span>
    </>
  );
}
