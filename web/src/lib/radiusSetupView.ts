/**
 * What the Radius section shows and allows: each step's state, which controls are available,
 * and whether the page has settled for announcements. One change, read or
 * failure at a time locks every step; a step Pi reports as blocked, or one that needs the account,
 * stays unavailable on its own. Each tool's wording — its row, actions, uninstall confirmation and
 * the toast its change earns — lives in `TOOLS` here, so the section renders both tools with one
 * row. Pure; `radiusSetup.ts` feeds it and the section renders it.
 */
import type { RadiusSetupAction, RadiusSetupState } from "@shared/radius";
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
}

export type WebSearchAction = "install" | "uninstall";

export interface RadiusSetupView {
  /** A change other than sign-out is in flight. */
  changing: boolean;
  /** Every step's controls wait: a change, read, web-search change or read failure is ongoing. */
  locked: boolean;
  /** Refresh waits only for a change or read already in flight. */
  canRefresh: boolean;
  /** Why setup needs attention: the read failed. A failed change is a toast instead. */
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
  mcp: RadiusToolView;
  webSearch: RadiusToolView;
  /** Signed in, with both tools ready and no failed web-search change. */
  configured: boolean;
  /** Read, with nothing running and nothing failing. */
  settled: boolean;
  installationError?: { title: string; detail?: string };
}

/** The setup actions that uninstall a tool, after confirmation; they name its reviewed configuration. */
export type RadiusUninstall = Extract<RadiusSetupAction, "remove-mcp" | "uninstall-web-search">;
type RadiusInstall = Exclude<RadiusSetupAction, RadiusUninstall>;

/** One tool's row: what it is, whether it is installed, and its install and uninstall controls. */
export interface RadiusToolView {
  title: string;
  ready: boolean;
  /** Read to screen readers beside the title once ready. */
  readyLabel: string;
  /** Why Pi reports this tool as it does, when it says. */
  detail?: string;
  /** Offered until the tool is installed. */
  install?: { label: string; ariaLabel: string; enabled: boolean; action: RadiusInstall };
  /** Offered while Pi reports configuration this page can uninstall. */
  uninstall?: {
    label: string;
    ariaLabel: string;
    enabled: boolean;
    confirmation: { kind: RadiusUninstall; key: string };
  };
  /** The change Pi is running for this tool, labelled for the control that replaces the actions. */
  change?: { action: WebSearchAction; label: string };
}

interface RadiusToolCopy {
  title: string;
  install: { action: RadiusInstall; ariaLabel: string; done?: string };
  uninstall: {
    action: RadiusUninstall;
    ariaLabel: string;
    done?: string;
    confirmation: { title: string; description: string; action: string };
  };
}

// Web search's changes run in Pi's background; `radiusAnnouncements` reports their outcome.
const TOOLS = {
  mcp: {
    title: "Radius MCP",
    install: {
      action: "configure-mcp",
      ariaLabel: "Install Radius MCP",
      done: "Radius MCP installed. Start a new session to use it.",
    },
    uninstall: {
      action: "remove-mcp",
      ariaLabel: "Uninstall Radius MCP",
      done: "Radius MCP uninstalled for new sessions.",
      confirmation: {
        title: "Uninstall Radius MCP?",
        description: "Uninstalls Radius MCP from Pi on this machine.",
        action: "Uninstall",
      },
    },
  },
  webSearch: {
    title: "Web search",
    install: { action: "install-web-search", ariaLabel: "Install web search" },
    uninstall: {
      action: "uninstall-web-search",
      ariaLabel: "Uninstall web search",
      confirmation: {
        title: "Uninstall web search?",
        description: "Removes the Radius web-search extension from Pi on this machine.",
        action: "Uninstall",
      },
    },
  },
} satisfies Record<"mcp" | "webSearch", RadiusToolCopy>;

const toolView = (
  copy: RadiusToolCopy,
  step: RadiusSetupState["mcp"] | undefined,
  { locked, signedIn }: { locked: boolean; signedIn: boolean },
  change?: RadiusToolView["change"],
): RadiusToolView => {
  const ready = step?.status === "ready";
  return {
    title: copy.title,
    ready,
    readyLabel: "Installed",
    detail: step?.detail,
    install: ready
      ? undefined
      : {
          label: "Install",
          ariaLabel: copy.install.ariaLabel,
          enabled: !locked && step?.status !== "blocked" && signedIn,
          action: copy.install.action,
        },
    uninstall: step?.removalKey
      ? {
          label: "Uninstall",
          ariaLabel: copy.uninstall.ariaLabel,
          enabled: !locked,
          confirmation: { kind: copy.uninstall.action, key: step.removalKey },
        }
      : undefined,
    change,
  };
};

const LOAD_FAILED = "Could not refresh Radius setup. Check your connection and try again.";

export function radiusSetupView({
  state,
  providers,
  running,
  refreshing,
  loadFailed,
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
  const attention = loadFailed ? LOAD_FAILED : undefined;
  return {
    changing,
    locked,
    canRefresh: running === undefined && !refreshing,
    attention,
    account: {
      signedIn,
      available: !!radius,
      // Only the state the row cannot show itself: why there is no Sign in button.
      description:
        !signedIn && !radius ? "Radius sign-in is unavailable in this Pi installation." : undefined,
      canSignIn: !signedIn && !!radius && !locked,
      canSignOut: signedIn && !locked,
      signingOut,
    },
    mcp: toolView(TOOLS.mcp, state?.mcp, { locked, signedIn }),
    webSearch: toolView(
      TOOLS.webSearch,
      state?.webSearch,
      { locked, signedIn },
      installing
        ? { action, label: action === "uninstall" ? "Uninstalling…" : "Installing…" }
        : undefined,
    ),
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

const uninstalls = Object.values(TOOLS).map((tool) => tool.uninstall);

/** The uninstall dialog's wording; it follows the confirmation's kind, which outlives the tool's row. */
export function radiusUninstallCopy(kind: RadiusUninstall | undefined) {
  return (uninstalls.find((uninstall) => uninstall.action === kind) ?? TOOLS.webSearch.uninstall)
    .confirmation;
}

/** The toast a finished setup change earns, if it announces itself on completion. */
export function radiusDoneMessage(action: RadiusSetupAction): string | undefined {
  for (const tool of Object.values(TOOLS) as RadiusToolCopy[])
    for (const change of [tool.install, tool.uninstall])
      if (change.action === action) return change.done;
  return undefined;
}
