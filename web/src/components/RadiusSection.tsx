import { cn } from "cn";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DisclosureChevron } from "@/components/Disclosure";
import { IconButton } from "@/components/IconButton";
import { PianoSkeleton as Skeleton } from "@/components/PianoSkeleton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { RemovalDialog } from "@/components/RemovalDialog";
import { SettingsAlert, SettingsSkeleton } from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { radiusRemovalCopy } from "@/lib/radiusSetupView";
import { useRadiusSetup } from "@/lib/useRadiusSetup";

/**
 * Radius on the Providers page: the account, and what Pi may use from it. Radius is here rather
 * than in the provider list because signing in is only the first of its steps.
 *
 * `reveal` is navigation's request count for the address and palette row that name Radius
 * directly: each new request opens the tools and scrolls to this first section. Counting requests
 * rather than reading a flag lets the same row asked for twice reveal Radius twice.
 */
export function RadiusSection({ reveal }: { reveal?: number }) {
  const setup = useRadiusSetup();
  const { view, confirmation, confirming, refreshing, providers } = setup;
  const { account, tools, mcp, webSearch } = view;
  const removal = confirmation && confirmation.kind !== "sign-out" ? confirmation : undefined;
  const anchor = useRef<HTMLElement>(null);
  const [toolsOpen, setToolsOpen] = useState(reveal !== undefined);
  useEffect(() => {
    if (reveal === undefined) return;
    setToolsOpen(true);
    // Radius is first, so its position no longer depends on the provider catalog loading.
    anchor.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [reveal]);
  return (
    <section
      id="settings-radius"
      ref={anchor}
      aria-labelledby="settings-radius-title"
      className="flex scroll-mt-4 flex-col gap-3"
    >
      <div className="flex min-h-8 items-center gap-2">
        <h2
          id="settings-radius-title"
          className="flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold"
        >
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <use href="/provider-logos/radius.svg#logo" />
          </svg>
          Radius
        </h2>
        <IconButton label="Refresh setup" disabled={!view.canRefresh} onClick={setup.refreshByHand}>
          <RefreshCwIcon
            className={cn(
              refreshing && "animate-spin [animation-duration:600ms] motion-reduce:animate-none",
            )}
          />
        </IconButton>
      </div>
      {view.attention && (
        <SettingsAlert title="Radius setup needs attention">{view.attention}</SettingsAlert>
      )}
      {!setup.loaded ? (
        <SettingsSkeleton label="Loading Radius setup…" className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </SettingsSkeleton>
      ) : (
        <>
          <Item variant="outline" className="rounded-xl px-4 sm:px-5">
            <ItemContent className="min-w-0">
              <ItemTitle>
                Account
                <ReadyMark ready={account.signedIn} label="Signed in" />
              </ItemTitle>
              {account.description && (
                <ItemDescription className="line-clamp-none">{account.description}</ItemDescription>
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
          <Collapsible open={toolsOpen} onOpenChange={setToolsOpen} className="rounded-xl border">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-3 rounded-xl px-4 py-3 text-left whitespace-normal data-[state=open]:rounded-b-none sm:px-5"
              >
                <DisclosureChevron open={toolsOpen} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    Tools and web search
                    <ReadyMark ready={tools.ready} label="Set up" />
                  </span>
                  {/* The steps' progress stays readable while the steps themselves are folded away. */}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {tools.summary}
                  </span>
                </span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="disclosure-content">
              <div className="border-t px-4 py-3 sm:px-5">
                <a
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
                  href="https://radius.earendil.com/docs/extensions"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Setup guide
                  <ExternalLinkIcon className="size-3.5" aria-hidden />
                </a>
              </div>
              <ItemGroup className="border-t">
                <Item className="rounded-none px-4 sm:px-5">
                  <ItemMedia variant="icon">
                    <WrenchIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      Radius MCP
                      <ReadyMark ready={mcp.ready} label="Added" />
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      Give Pi your Radius tools, using the same sign-in.
                    </ItemDescription>
                    {mcp.detail && <p className="text-xs text-muted-foreground">{mcp.detail}</p>}
                  </ItemContent>
                  <ItemActions className="max-sm:basis-full max-sm:pl-12">
                    {!mcp.ready && (
                      <Button
                        size="sm"
                        disabled={!mcp.canAdd}
                        aria-label="Add Radius MCP"
                        onClick={() => void setup.act("configure-mcp")}
                      >
                        Add
                      </Button>
                    )}
                    {mcp.removalKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground max-sm:-mx-2.5"
                        disabled={!mcp.canRemove}
                        onClick={() => setup.confirm({ kind: "remove-mcp", key: mcp.removalKey! })}
                        aria-label="Remove Radius MCP"
                      >
                        Remove
                      </Button>
                    )}
                  </ItemActions>
                </Item>
                <ItemSeparator />
                <Item className="rounded-none px-4 sm:px-5">
                  <ItemMedia variant="icon">
                    <GlobeIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      Web search
                      <ReadyMark ready={webSearch.ready} label="Installed" />
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      Let Pi search the web with the Radius extension.
                    </ItemDescription>
                    {webSearch.detail && (
                      <p className="text-xs text-muted-foreground">{webSearch.detail}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      An organization owner or admin must enable Web search separately in Radius.
                    </p>
                  </ItemContent>
                  <ItemActions className="max-sm:basis-full max-sm:pl-12">
                    {webSearch.change ? (
                      <Button
                        variant={webSearch.change.action === "uninstall" ? "ghost" : "default"}
                        size="sm"
                        disabled
                      >
                        <Spinner data-icon="inline-start" />
                        {webSearch.change.label}
                      </Button>
                    ) : (
                      <>
                        {!webSearch.ready && (
                          <Button
                            size="sm"
                            disabled={!webSearch.canInstall}
                            aria-label="Install web search"
                            onClick={() => void setup.act("install-web-search")}
                          >
                            Install
                          </Button>
                        )}
                        {webSearch.removalKey && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground max-sm:-mx-2.5"
                            disabled={!webSearch.canRemove}
                            onClick={() =>
                              setup.confirm({
                                kind: "uninstall-web-search",
                                key: webSearch.removalKey!,
                              })
                            }
                            aria-label="Uninstall web search"
                          >
                            Uninstall
                          </Button>
                        )}
                      </>
                    )}
                  </ItemActions>
                </Item>
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
      {view.installationError && (
        <SettingsAlert title={view.installationError.title}>
          {view.installationError.detail}
        </SettingsAlert>
      )}
      {/* Keeps the last removal's wording while it animates closed. */}
      <RemovalDialog
        open={confirming && !!removal}
        busy={view.changing}
        disabled={view.locked}
        cancel={setup.cancel}
        {...radiusRemovalCopy(removal?.kind)}
        confirm={setup.confirmRemoval}
      />
      {confirming && confirmation?.kind === "sign-out" && (
        <ProviderSignOutDialog
          name="Radius"
          busy={account.signingOut}
          cancel={setup.cancel}
          confirm={() => void setup.signOut()}
        />
      )}
      {setup.signIn && (
        <ProviderLoginDialog
          key={setup.signIn.key}
          initialProvider="radius"
          providers={providers}
          close={setup.closeSignIn}
          signedIn={setup.signedIn}
        />
      )}
    </section>
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
