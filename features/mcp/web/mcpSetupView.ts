import {
  MCP_CATALOG,
  type McpCatalogId,
  type McpCatalogServer,
  type McpServerSetup,
  type McpSetupState,
} from "../contracts/mcp.ts";

export interface McpSetupInput {
  state: McpSetupState | undefined;
  running: string | undefined;
  loading: boolean;
}

export interface McpServerRow {
  setup: McpServerSetup;
  title: string;
  catalog?: McpCatalogId;
  value: string;
  ready: boolean;
  detail?: string;
  reconnect: boolean;
  editable: boolean;
  removeVerb: "Disconnect" | "Delete";
}

export interface McpAvailableRow {
  server: McpCatalogServer;
  detail?: string;
}

export interface McpSetupView {
  rows: readonly McpServerRow[] | undefined;
  available: readonly McpAvailableRow[] | undefined;
  problem?: string;
  disabled: boolean;
}

const catalogServer = (id: McpCatalogId | undefined) =>
  id === undefined ? undefined : MCP_CATALOG.find((server) => server.id === id);

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
  const oauth = setup.auth.kind === "oauth";
  return {
    setup,
    title: catalog?.name ?? setup.name,
    ...(catalog ? { catalog: catalog.id } : {}),
    value: configValue(setup),
    ready: !setup.detail && (!oauth || setup.signedIn),
    ...(setup.detail ? { detail: setup.detail } : {}),
    reconnect: !setup.detail && oauth && !setup.signedIn,
    editable: !catalog,
    removeVerb: "url" in setup.config ? "Disconnect" : "Delete",
  };
}

export function mcpSetupView({ state, running, loading }: McpSetupInput): McpSetupView {
  return {
    rows: state?.servers
      .map(mcpServerRow)
      .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" })),
    available: state?.available
      .flatMap((entry) => {
        const server = catalogServer(entry.id);
        return server ? [{ server, ...(entry.detail ? { detail: entry.detail } : {}) }] : [];
      })
      .sort((a, b) => a.server.name.localeCompare(b.server.name, "en", { sensitivity: "base" })),
    ...(state?.problem ? { problem: state.problem } : {}),
    disabled: running !== undefined || loading || !!state?.problem,
  };
}

export function mcpRemovalCopy(row: Pick<McpServerRow, "title" | "removeVerb">) {
  const name = row.title;
  return row.removeVerb === "Disconnect"
    ? {
        title: `Disconnect MCP ${name}?`,
        description: `Removes MCP ${name} and its saved sign-in from Pi on this machine.`,
        action: "Disconnect",
        progress: "Disconnecting…",
        done: "MCP server disconnected",
      }
    : {
        title: `Delete MCP ${name}?`,
        description: `Removes MCP ${name} from Pi on this machine.`,
        action: "Delete",
        progress: "Deleting…",
        done: "MCP server deleted",
      };
}
