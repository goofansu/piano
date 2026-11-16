import type { RadiusSetupAction, RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";

export interface RadiusSetupInput {
  state: RadiusSetupState | undefined;
  providers: readonly OAuthProvider[];
  running: string | undefined;
  refreshing: boolean;
  loadFailed: boolean;
}

export type WebSearchAction = "install" | "uninstall";

export interface RadiusSetupView {
  changing: boolean;
  locked: boolean;
  canRefresh: boolean;
  attention: string | undefined;
  account: {
    signedIn: boolean;
    available: boolean;
    description: string | undefined;
    canSignIn: boolean;
    canSignOut: boolean;
    signingOut: boolean;
  };
  mcp: RadiusToolView;
  webSearch: RadiusToolView;
  configured: boolean;
  settled: boolean;
  installationError?: { title: string; detail?: string };
}

export type RadiusUninstall = Extract<RadiusSetupAction, "remove-mcp" | "uninstall-web-search">;
type RadiusInstall = Exclude<RadiusSetupAction, RadiusUninstall>;

export interface RadiusToolView {
  title: string;
  ready: boolean;
  readyLabel: string;
  detail?: string;
  install?: { label: string; ariaLabel: string; enabled: boolean; action: RadiusInstall };
  uninstall?: {
    label: string;
    ariaLabel: string;
    enabled: boolean;
    confirmation: { kind: RadiusUninstall; key: string };
  };
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

const TOOLS = {
  mcp: {
    title: "Radius MCP",
    install: {
      action: "configure-mcp",
      ariaLabel: "Install Radius MCP",
      done: "Radius MCP installed for new sessions",
    },
    uninstall: {
      action: "remove-mcp",
      ariaLabel: "Uninstall Radius MCP",
      done: "Radius MCP uninstalled for new sessions",
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

export function radiusUninstallCopy(kind: RadiusUninstall | undefined) {
  return (uninstalls.find((uninstall) => uninstall.action === kind) ?? TOOLS.webSearch.uninstall)
    .confirmation;
}

export function radiusDoneMessage(action: RadiusSetupAction): string | undefined {
  for (const tool of Object.values(TOOLS) as RadiusToolCopy[])
    for (const change of [tool.install, tool.uninstall])
      if (change.action === action) return change.done;
  return undefined;
}
