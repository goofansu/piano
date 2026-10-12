import type { RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";
import { cn } from "cn";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshCwIcon,
  UserRoundIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { RemovalDialog } from "@/components/RemovalDialog";
import {
  SettingsAlert,
  SettingsSectionFrame,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { oauthProviders, providerLogout, type RadiusSetupAction, radiusSetup } from "@/lib/api";
import {
  RADIUS_PROGRESS,
  type RadiusObservation,
  radiusAnnouncements,
} from "@/lib/radiusAnnouncements";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

type Confirmation =
  | { kind: "sign-out" }
  | { kind: "remove-mcp" | "uninstall-web-search"; key: string };

/** One turn of the refresh icon, so a fast refresh still reads as a refresh instead of a flicker. */
const REFRESH_SPIN_MS = 600;
/** Setup toasts share an id, so finishing setup replaces the step's toast instead of stacking. */
const SETUP_TOAST = "radius-setup";
const INSTALL_POLL_MS = 1500;

export function RadiusSettings({ onMenu }: { onMenu: () => void }) {
  const manualRefresh = useRef(false);
  const progress = useRef(RADIUS_PROGRESS);
  const announce = useCallback((observation: RadiusObservation) => {
    const { progress: next, message } = radiusAnnouncements(progress.current, observation);
    progress.current = next;
    if (message) toast.success(message, { id: SETUP_TOAST });
  }, []);
  // A running web-search change is polled until it settles.
  const setup = useObservation<{ state: RadiusSetupState; providers: OAuthProvider[] }>(
    "radius",
    async (signal) => {
      const manual = manualRefresh.current;
      manualRefresh.current = false;
      const [next, signIns] = await Promise.all([
        radiusSetup(undefined, { signal }),
        oauthProviders({ signal }),
        manual && new Promise((resolve) => setTimeout(resolve, REFRESH_SPIN_MS)),
      ]);
      if (signal.aborted) throw signal.reason;
      announce({ kind: "observed", installation: next.installation, manual });
      return { state: next, providers: [...signIns] };
    },
    {
      interval: (value) =>
        value?.state.installation.status === "running" ? INSTALL_POLL_MS : undefined,
    },
  );
  const state = setup.value?.state,
    providers = setup.value?.providers ?? [];
  const refreshing = setup.loading || (!setup.value && !setup.error);
  const error =
    setup.error && !setup.loading
      ? "Could not refresh Radius setup. Check your connection and try again."
      : "";
  const { refresh } = setup;
  // Signing in or out changes the usable models; the server invalidates every catalog itself.
  const actions = useSetupActions<Confirmation, string>({
    refresh: () => void refresh(),
    success: (text, id) => toast.success(text, id === "sign-out" ? undefined : { id: SETUP_TOAST }),
  });
  const { confirmation, confirming } = actions;
  const busy = actions.running !== undefined && actions.running !== "sign-out";
  const signingOut = actions.running === "sign-out";
  const signOut = () =>
    actions.run({
      id: "sign-out",
      // Only acknowledge sign-out after Pi confirms credential removal.
      run: () =>
        setup.mutate(async (_signal, previous) => {
          await providerLogout("radius");
          return (
            previous && {
              ...previous,
              providers: previous.providers.map((provider) =>
                provider.id === "radius" ? { ...provider, signedIn: false } : provider,
              ),
            }
          );
        }),
      done: "Signed out of Radius.",
      fallback: "Could not sign out. Try again.",
    });
  const act = (action: RadiusSetupAction, removalKey?: string) =>
    actions.run({
      id: action,
      run: () =>
        setup.mutate(async (_signal, previous) => {
          const next = await radiusSetup({ action, removalKey });
          announce({ kind: "observed", installation: next.installation });
          return previous && { ...previous, state: next };
        }),
      done:
        action === "configure-mcp"
          ? "Radius MCP added. Start a new session to use it."
          : action === "remove-mcp"
            ? "Radius MCP removed for new sessions."
            : undefined,
      fallback: "Could not complete setup. Refresh before retrying.",
    });
  const radius = providers.find((provider) => provider.id === "radius");
  const installing = state?.installation.status === "running";
  const disabled = busy || signingOut || refreshing || installing || !!error;
  const configured =
    !!radius?.signedIn &&
    state?.mcp.status === "ready" &&
    state.webSearch.status === "ready" &&
    state.installation.status !== "error";
  const settled =
    !!state && !busy && !signingOut && !refreshing && !installing && !error && !actions.error;
  // Announce completion only when setup turns complete here, not each time a complete setup is opened.
  useEffect(() => {
    if (settled) announce({ kind: "settled", configured });
  }, [settled, configured, announce]);
  const signedIn = !!radius?.signedIn;
  const mcpReady = state?.mcp.status === "ready";
  const webSearchReady = state?.webSearch.status === "ready";
  const removal = confirmation && confirmation.kind !== "sign-out" ? confirmation : undefined;
  return (
    <SettingsSectionFrame
      title="Radius"
      onMenu={onMenu}
      actions={
        <IconButton
          label="Refresh setup"
          disabled={busy || signingOut || refreshing}
          onClick={() => {
            actions.clearError();
            manualRefresh.current = true;
            void refresh();
          }}
        >
          <RefreshCwIcon
            className={cn(
              refreshing && "animate-spin [animation-duration:600ms] motion-reduce:animate-none",
            )}
          />
        </IconButton>
      }
      dialogs={
        <>
          {/* Keeps the last removal's wording while it animates closed. */}
          <RemovalDialog
            open={confirming && !!removal}
            busy={busy}
            disabled={disabled}
            cancel={actions.cancel}
            title={removal?.kind === "remove-mcp" ? "Remove Radius MCP?" : "Uninstall web search?"}
            description={
              removal?.kind === "remove-mcp"
                ? "Removes Radius MCP from Pi on this machine."
                : "Removes the Radius web-search extension from Pi on this machine."
            }
            action={removal?.kind === "remove-mcp" ? "Remove" : "Uninstall"}
            confirm={() => {
              if (removal) void act(removal.kind, removal.key);
            }}
          />
          {confirming && confirmation?.kind === "sign-out" && (
            <ProviderSignOutDialog
              name="Radius"
              busy={signingOut}
              cancel={actions.cancel}
              confirm={() => void signOut()}
            />
          )}
          {actions.signIn && (
            <ProviderLoginDialog
              key={actions.signIn.key}
              initialProvider="radius"
              providers={providers}
              close={() => {
                actions.closeSignIn();
                void refresh();
              }}
              signedIn={() => void refresh()}
            />
          )}
        </>
      }
    >
      <p className="max-w-prose text-sm text-muted-foreground">
        Sign in once, then choose what Pi can use from Radius.{" "}
        <a
          className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
          href="https://radius.earendil.com/docs/extensions"
          target="_blank"
          rel="noopener noreferrer"
        >
          Setup guide
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      </p>
      {(error || actions.error) && (
        <SettingsAlert title="Radius setup needs attention">{error || actions.error}</SettingsAlert>
      )}
      {!state ? (
        <SettingsSkeleton label="Loading Radius setup…" className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </SettingsSkeleton>
      ) : (
        <>
          <Item variant="outline" className="rounded-xl px-4 sm:px-5">
            <ItemMedia variant="icon">
              <UserRoundIcon />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>
                Radius account
                <ReadyMark ready={signedIn} label="Signed in" />
              </ItemTitle>
              <ItemDescription className="line-clamp-none">
                {!radius
                  ? "Radius sign-in is unavailable in this Pi installation."
                  : signedIn
                    ? "Signed in. You stay signed in until you sign out."
                    : "Sign in to set up Radius tools and web search."}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="max-sm:basis-full max-sm:pl-12">
              {signedIn ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground max-sm:-mx-2.5"
                  disabled={disabled}
                  aria-label="Sign out of Radius"
                  onClick={() => actions.confirm({ kind: "sign-out" })}
                >
                  {signingOut && <Spinner data-icon="inline-start" />}
                  {signingOut ? "Signing out…" : "Sign out"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={disabled || !radius}
                  aria-label="Sign in to Radius"
                  onClick={() => actions.openSignIn("radius")}
                >
                  Sign in
                </Button>
              )}
            </ItemActions>
          </Item>
          <section aria-labelledby="radius-features" className="flex flex-col gap-3">
            <h2 id="radius-features" className="text-sm font-medium">
              Use in Pi
            </h2>
            <ItemGroup className="rounded-xl border">
              <Item className="rounded-none px-4 sm:px-5">
                <ItemMedia variant="icon">
                  <WrenchIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    Radius MCP
                    <ReadyMark ready={mcpReady} label="Added" />
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    Give Pi your Radius tools, using the same sign-in.
                  </ItemDescription>
                  {state.mcp.detail && (
                    <p className="text-xs text-muted-foreground">{state.mcp.detail}</p>
                  )}
                </ItemContent>
                <ItemActions className="max-sm:basis-full max-sm:pl-12">
                  {!mcpReady && (
                    <Button
                      size="sm"
                      disabled={disabled || state.mcp.status === "blocked" || !signedIn}
                      aria-label="Add Radius MCP"
                      onClick={() => void act("configure-mcp")}
                    >
                      Add
                    </Button>
                  )}
                  {state.mcp.removalKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground max-sm:-mx-2.5"
                      disabled={disabled}
                      onClick={() =>
                        actions.confirm({ kind: "remove-mcp", key: state.mcp.removalKey! })
                      }
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
                    <ReadyMark ready={webSearchReady} label="Installed" />
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    Let Pi search the web with the Radius extension.
                  </ItemDescription>
                  {state.webSearch.detail && (
                    <p className="text-xs text-muted-foreground">{state.webSearch.detail}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    An organization owner or admin must enable Web search separately in Radius.
                  </p>
                </ItemContent>
                <ItemActions className="max-sm:basis-full max-sm:pl-12">
                  {installing ? (
                    <Button
                      variant={state.installation.action === "uninstall" ? "ghost" : "default"}
                      size="sm"
                      disabled
                    >
                      <Spinner data-icon="inline-start" />
                      {state.installation.action === "uninstall" ? "Uninstalling…" : "Installing…"}
                    </Button>
                  ) : (
                    <>
                      {!webSearchReady && (
                        <Button
                          size="sm"
                          disabled={disabled || state.webSearch.status === "blocked" || !signedIn}
                          aria-label="Install web search"
                          onClick={() => void act("install-web-search")}
                        >
                          Install
                        </Button>
                      )}
                      {state.webSearch.removalKey && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground max-sm:-mx-2.5"
                          disabled={disabled}
                          onClick={() =>
                            actions.confirm({
                              kind: "uninstall-web-search",
                              key: state.webSearch.removalKey!,
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
          </section>
        </>
      )}
      {state?.installation.status === "error" && (
        <SettingsAlert
          title={
            state.installation.action === "uninstall"
              ? "Web search was not uninstalled"
              : "Web search was not installed"
          }
        >
          {state.installation.detail}
        </SettingsAlert>
      )}
    </SettingsSectionFrame>
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
