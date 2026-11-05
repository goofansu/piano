/**
 * What the MCP section shows and allows: one row per entry of Pi's global configuration, with its
 * ready mark and the actions it offers; one row per catalog server not configured yet; and whether
 * its controls wait. A change, read or read failure in flight disables every row. Pure; the
 * section renders it, and shows a failed read itself.
 */
import {
  MCP_CATALOG,
  type McpCatalogId,
  type McpCatalogServer,
  type McpServerSetup,
  type McpSetupState,
} from "../../../shared/mcp.ts";

export interface McpSetupInput {
  /** Pi's setup as last read; absent until the first read succeeds. */
  state: McpSetupState | undefined;
  /** The id of the setup change in flight, such as "install" or "sign-out". */
  running: string | undefined;
  /** A read of the setup is in flight. */
  loading: boolean;
  /** The last read failed and no read is in flight. */
  loadFailed: boolean;
}

/** A configured row's controls, in the order they appear. */
export type McpServerAction = "sign-in" | "sign-out" | "edit" | "remove";

export interface McpServerRow {
  setup: McpServerSetup;
  /** How the user knows it: the catalog server's name, else the entry's own. */
  title: string;
  /** The catalog server this entry is, for its brand mark. */
  catalog?: McpCatalogId;
  /** The row's second line: the endpoint's host, or the command and its arguments. */
  value: string;
  /** Configured, and signed in when Pi signs in to it with OAuth. */
  ready: boolean;
  /** A configuration problem the user must fix in Pi. */
  detail?: string;
  actions: readonly McpServerAction[];
}

export interface McpAvailableRow {
  server: McpCatalogServer;
  /** Why Add is not offered as is. */
  detail?: string;
}

export interface McpSetupView {
  /** Pi's entries in file order; absent until the first read succeeds. */
  rows: readonly McpServerRow[] | undefined;
  /** Catalog servers not configured, in catalog order; absent until the first read succeeds. */
  available: readonly McpAvailableRow[] | undefined;
  /** Pi's configuration cannot be used until fixed in Pi: the page says so and offers nothing. */
  problem?: string;
  /** Every row's controls wait: a change, read or read failure is ongoing. */
  disabled: boolean;
}

const catalogServer = (id: McpCatalogId | undefined) =>
  id === undefined ? undefined : MCP_CATALOG.find((server) => server.id === id);

/** The row's second line: a URL by its host, a command with its arguments. */
export const configValue = (setup: McpServerSetup): string => {
  const { config } = setup;
  if ("command" in config) return [config.command, ...config.args].join(" ");
  try {
    return new URL(config.url).host || config.url;
  } catch {
    return config.url;
  }
};

export function mcpServerRow(setup: McpServerSetup): McpServerRow {
  const catalog = catalogServer(setup.catalog);
  const actions: McpServerAction[] = [];
  if (!setup.detail && setup.oauth) actions.push(setup.signedIn ? "sign-out" : "sign-in");
  actions.push("edit", "remove");
  return {
    setup,
    title: catalog?.name ?? setup.name,
    ...(catalog ? { catalog: catalog.id } : {}),
    value: configValue(setup),
    ready: !setup.detail && (!setup.oauth || setup.signedIn),
    ...(setup.detail ? { detail: setup.detail } : {}),
    actions,
  };
}

export function mcpSetupView({ state, running, loading, loadFailed }: McpSetupInput): McpSetupView {
  return {
    rows: state?.servers.map(mcpServerRow),
    available: state?.available.flatMap((entry) => {
      const server = catalogServer(entry.id);
      return server ? [{ server, ...(entry.detail ? { detail: entry.detail } : {}) }] : [];
    }),
    ...(state?.problem ? { problem: state.problem } : {}),
    disabled: running !== undefined || loading || loadFailed || !!state?.problem,
  };
}

/** Whether the entry is ready but awaits an OAuth sign-in. */
const awaitsSignIn = (setup: McpServerSetup | undefined) =>
  !!setup && !setup.detail && setup.oauth && !setup.signedIn;

/**
 * Installing is the decision to use the server: after an install, sign in straight away when Pi
 * reports the catalog server's entry ready but awaiting an OAuth sign-in. Returns the entry to
 * sign in to.
 */
export function signInAfterInstall(
  state: McpSetupState | undefined,
  server: McpCatalogId,
): McpServerSetup | undefined {
  const installed = state?.servers.find((setup) => setup.catalog === server);
  return awaitsSignIn(installed) ? installed : undefined;
}

/** After adding entries, the first of them awaiting an OAuth sign-in, if any. */
export function signInAfterAdd(
  state: McpSetupState | undefined,
  names: readonly string[],
): McpServerSetup | undefined {
  return names
    .map((name) => state?.servers.find((setup) => setup.name === name))
    .find(awaitsSignIn);
}

/** The removal dialog's wording and the toast once it is done. */
export function mcpRemovalCopy(row: Pick<McpServerRow, "title"> | undefined) {
  const name = row?.title;
  return {
    title: `Remove ${name} MCP?`,
    description: `Removes ${name} MCP and its saved sign-in from Pi on this machine.`,
    action: "Remove",
    done: `${name} MCP removed for new sessions.`,
  };
}
