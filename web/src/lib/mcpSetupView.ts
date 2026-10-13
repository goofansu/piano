/**
 * What the MCP section shows and allows: one row per catalog server Pi reports, with its ready mark
 * and the actions it offers, whether the section needs attention, and whether its controls wait.
 * A change, read or read failure in flight disables every row. Pure; the section renders it.
 */
import { MCP_CATALOG, type McpSetupState } from "../../../shared/mcp.ts";

export type McpServer = (typeof MCP_CATALOG)[number];

export interface McpSetupInput {
  /** Pi's setup as last read; absent until the first read succeeds. */
  state: McpSetupState | undefined;
  /** The id of the setup change in flight, such as "install" or "sign-out". */
  running: string | undefined;
  /** A read of the setup is in flight. */
  loading: boolean;
  /** The last read failed and no read is in flight. */
  loadFailed: boolean;
  /** The last change's failure, or "" when it succeeded. */
  actionError: string;
}

/** A server row's controls, in the order they appear. */
export type McpServerAction = "install" | "sign-in" | "sign-out" | "uninstall";

export interface McpServerRow {
  server: McpServer;
  /** Configured, and signed in when Pi signs in to it with OAuth. */
  ready: boolean;
  /** A configuration problem the user must fix in Pi. */
  detail?: string;
  actions: readonly McpServerAction[];
  /** Identity of the configuration the uninstall confirmation removes. */
  removalKey?: string;
}

export interface McpSetupView {
  /** Catalog order, servers Pi reports only; absent until the first read succeeds. */
  rows: readonly McpServerRow[] | undefined;
  /** Every row's controls wait: a change, read or read failure is ongoing. */
  disabled: boolean;
  /** Why setup needs attention: the read failed or the last change did. */
  attention: string | undefined;
}

const LOAD_FAILED = "Could not load MCP servers. Check your connection and try again.";

export function mcpSetupView({
  state,
  running,
  loading,
  loadFailed,
  actionError,
}: McpSetupInput): McpSetupView {
  const rows = state
    ? MCP_CATALOG.flatMap((server): McpServerRow[] => {
        const setup = state.servers.find((s) => s.id === server.id);
        if (!setup) return [];
        const ready = setup.status === "ready";
        const actions: McpServerAction[] = [];
        if (setup.status === "missing") actions.push("install");
        if (ready && setup.oauth) actions.push(setup.signedIn ? "sign-out" : "sign-in");
        if (setup.removalKey) actions.push("uninstall");
        return [
          {
            server,
            ready: ready && (!setup.oauth || setup.signedIn),
            detail: setup.detail,
            actions,
            removalKey: setup.removalKey,
          },
        ];
      })
    : undefined;
  return {
    rows,
    disabled: running !== undefined || loading || loadFailed,
    attention: (loadFailed ? LOAD_FAILED : "") || actionError || undefined,
  };
}

/**
 * Installing is the decision to use the server: after an install, sign in straight away when Pi
 * reports it ready but awaiting an OAuth sign-in.
 */
export function signInAfterInstall(
  state: McpSetupState | undefined,
  server: McpServer["id"],
): boolean {
  const installed = state?.servers.find((s) => s.id === server);
  return installed?.status === "ready" && installed.oauth && !installed.signedIn;
}

/** The uninstall dialog's wording and the toast once it is done. */
export function mcpRemovalCopy(name: string | undefined) {
  return {
    title: `Uninstall ${name} MCP?`,
    description: `Removes ${name} MCP and its saved sign-in from Pi on this machine.`,
    action: "Uninstall",
    done: `${name} MCP uninstalled for new sessions.`,
  };
}
