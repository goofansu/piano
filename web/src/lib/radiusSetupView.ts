/**
 * What the Radius section shows and allows: each step's state, which controls are available, the
 * folded tools' summary, and whether the page has settled for announcements. One change, read or
 * failure at a time locks every step; a step Pi reports as blocked, or one that needs the account,
 * stays unavailable on its own. Pure, so the section only observes, mutates and renders.
 */
import type { RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";

export interface RadiusSetupInput {
  /** Pi's setup as last read; absent until the first read succeeds. */
  state: RadiusSetupState | undefined;
  /** The sign-ins Pi offers, including Radius when this installation has it. */
  providers: readonly OAuthProvider[];
  /** The id of the setup change in flight, such as "sign-out" or "install-web-search". */
  running: string | undefined;
  /** A read of the setup is in flight, or none has finished. */
  refreshing: boolean;
  /** The last read failed and no read is in flight. */
  loadFailed: boolean;
  /** The last change's failure, or "" when it succeeded. */
  actionError: string;
}

export type WebSearchAction = "install" | "uninstall";

export interface RadiusSetupView {
  /** A change other than sign-out is in flight. */
  changing: boolean;
  /** Every step's controls wait: a change, read, web-search change or read failure is ongoing. */
  locked: boolean;
  /** Refresh waits only for a change or read already in flight. */
  canRefresh: boolean;
  /** Why setup needs attention: the read failed or the last change did. */
  attention: string | undefined;
  account: {
    signedIn: boolean;
    /** This Pi installation offers Radius sign-in. */
    available: boolean;
    /** Shown while signed out. */
    description: string | undefined;
    canSignIn: boolean;
    canSignOut: boolean;
    signingOut: boolean;
  };
  /** The folded tools: whether both are set up and where they stand. */
  tools: { ready: boolean; summary: string };
  mcp: {
    ready: boolean;
    canAdd: boolean;
    removalKey?: string;
    canRemove: boolean;
    detail?: string;
  };
  webSearch: {
    ready: boolean;
    canInstall: boolean;
    removalKey?: string;
    canRemove: boolean;
    detail?: string;
    /** The web-search change Pi is running, labelled for its control. */
    change?: { action: WebSearchAction; label: string };
  };
  /** Signed in, with both tools ready and no failed web-search change. */
  configured: boolean;
  /** Read, with nothing running and nothing failing. */
  settled: boolean;
  installationError?: { title: string; detail?: string };
}

const LOAD_FAILED = "Could not refresh Radius setup. Check your connection and try again.";

export function radiusSetupView({
  state,
  providers,
  running,
  refreshing,
  loadFailed,
  actionError,
}: RadiusSetupInput): RadiusSetupView {
  const radius = providers.find((provider) => provider.id === "radius");
  const signingOut = running === "sign-out";
  const changing = running !== undefined && !signingOut;
  const installing = state?.installation.status === "running";
  const locked = running !== undefined || refreshing || installing || loadFailed;
  const signedIn = !!radius?.signedIn;
  const mcpReady = state?.mcp.status === "ready";
  const webSearchReady = state?.webSearch.status === "ready";
  // An installation without an action is the install Pi has always run.
  const action: WebSearchAction =
    state?.installation.action === "uninstall" ? "uninstall" : "install";
  const attention = (loadFailed ? LOAD_FAILED : "") || actionError || undefined;
  return {
    changing,
    locked,
    canRefresh: running === undefined && !refreshing,
    attention,
    account: {
      signedIn,
      available: !!radius,
      description: signedIn
        ? undefined
        : !radius
          ? "Radius sign-in is unavailable in this Pi installation."
          : "Sign in to set up Radius tools and web search.",
      canSignIn: !signedIn && !!radius && !locked,
      canSignOut: signedIn && !locked,
      signingOut,
    },
    tools: {
      ready: mcpReady && webSearchReady,
      summary: installing
        ? action === "uninstall"
          ? "Uninstalling web search…"
          : "Installing web search…"
        : `${mcpReady ? "MCP added" : "MCP not added"} · ${
            webSearchReady ? "Web search installed" : "Web search not installed"
          }`,
    },
    mcp: {
      ready: mcpReady,
      canAdd: !mcpReady && !locked && state?.mcp.status !== "blocked" && signedIn,
      removalKey: state?.mcp.removalKey,
      canRemove: !!state?.mcp.removalKey && !locked,
      detail: state?.mcp.detail,
    },
    webSearch: {
      ready: webSearchReady,
      canInstall: !webSearchReady && !locked && state?.webSearch.status !== "blocked" && signedIn,
      removalKey: state?.webSearch.removalKey,
      canRemove: !!state?.webSearch.removalKey && !locked,
      detail: state?.webSearch.detail,
      change: installing
        ? { action, label: action === "uninstall" ? "Uninstalling…" : "Installing…" }
        : undefined,
    },
    configured: signedIn && mcpReady && webSearchReady && state?.installation.status !== "error",
    settled: !!state && running === undefined && !refreshing && !installing && !attention,
    installationError:
      state?.installation.status === "error"
        ? {
            title:
              action === "uninstall"
                ? "Web search was not uninstalled"
                : "Web search was not installed",
            detail: state.installation.detail,
          }
        : undefined,
  };
}

export type RadiusRemoval = "remove-mcp" | "uninstall-web-search";

/** The removal dialog's wording; uninstalling web search unless MCP is named. */
export function radiusRemovalCopy(kind: RadiusRemoval | undefined) {
  return kind === "remove-mcp"
    ? {
        title: "Remove Radius MCP?",
        description: "Removes Radius MCP from Pi on this machine.",
        action: "Remove",
      }
    : {
        title: "Uninstall web search?",
        description: "Removes the Radius web-search extension from Pi on this machine.",
        action: "Uninstall",
      };
}
