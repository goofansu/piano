import { cn } from "cn";
import { MoreHorizontalIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "@/components/IconButton";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { RemovalDialog, signOutCopy } from "@/components/RemovalDialog";
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import {
  SettingsAlert,
  SettingsExternalLink,
  SettingsGroup,
  SettingsList,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { StatusDot } from "@/components/StatusDot";
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
            <Item
              data-row
              className={cn(
                settingsRow,
                "relative",
                rowActionsWidth.list[account.signedIn ? 1 : 0],
              )}
            >
              <ItemContent data-motion="yield" className="min-w-0 gap-0.5">
                <ItemTitle>Account</ItemTitle>
                {account.description && (
                  <ItemDescription className="line-clamp-none">
                    {account.description}
                  </ItemDescription>
                )}
                {account.signedIn && <ReadyLine label="Signed in" />}
              </ItemContent>
              {account.signedIn ? (
                <RowActions className={rowActionsPlace}>
                  <RowMenu
                    label="Radius account actions"
                    disabled={!account.canSignOut}
                    action="Sign out"
                    onSelect={() => setup.confirm({ kind: "sign-out" })}
                  />
                </RowActions>
              ) : (
                <ItemActions className="shrink-0">
                  <PianoButton
                    variant="outline"
                    size="sm"
                    disabled={!account.canSignIn}
                    aria-label="Sign in to Radius"
                    onClick={setup.openSignIn}
                  >
                    Sign in
                  </PianoButton>
                </ItemActions>
              )}
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
  const menu = uninstall && (
    <RowMenu
      label={`${tool.title} actions`}
      disabled={!uninstall.enabled}
      action={uninstall.label}
      actionLabel={uninstall.ariaLabel}
      onSelect={() => setup.confirm(uninstall.confirmation)}
    />
  );
  // The menu reveals over the row's end, unless Install already stands there: then it sits beside it.
  const revealed = menu && !install && !change;
  return (
    <Item data-row className={cn(settingsRow, "relative", rowActionsWidth.list[revealed ? 1 : 0])}>
      <ItemContent data-motion="yield" className="min-w-0 gap-0.5">
        <ItemTitle>{tool.title}</ItemTitle>
        {tool.detail && (
          <ItemDescription className="line-clamp-none">{tool.detail}</ItemDescription>
        )}
        {tool.ready && <ReadyLine label={tool.readyLabel} />}
      </ItemContent>
      {revealed ? (
        <RowActions className={rowActionsPlace}>{menu}</RowActions>
      ) : (
        <ItemActions className="shrink-0 gap-1">
          {change ? (
            <PianoButton variant="outline" size="sm" disabled>
              <Spinner data-icon="inline-start" />
              {change.label}
            </PianoButton>
          ) : (
            <>
              {install && (
                <PianoButton
                  variant="outline"
                  size="sm"
                  disabled={!install.enabled}
                  aria-label={install.ariaLabel}
                  onClick={() => void setup.act(install.action)}
                >
                  {install.label}
                </PianoButton>
              )}
              {menu}
            </>
          )}
        </ItemActions>
      )}
    </Item>
  );
}

/** Where a row's revealed ⋯ sits: centred on the row's end. */
const rowActionsPlace = "top-1/2 right-3 -translate-y-1/2";

/** A configured part's ⋯ menu, holding its one destructive action. */
function RowMenu({
  label,
  disabled,
  action,
  actionLabel,
  onSelect,
}: {
  label: string;
  disabled: boolean;
  action: string;
  actionLabel?: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PianoButton variant="ghost" size="list" aria-label={label} disabled={disabled}>
          <MoreHorizontalIcon />
        </PianoButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" aria-label={actionLabel} onSelect={onSelect}>
          {action}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The part's state once it is ready, on the row's meta line. */
function ReadyLine({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-3">
      <StatusDot tone="ok" />
      {label}
    </p>
  );
}
