import { Schema } from "effect";

/** A catalog server Pi starts as a local command, as the browser may know it: the CLI's path is
 * relative to the home directory of the account running Piano, which resolves it (INV-11). */
export interface McpCatalogCommand {
  /** Path of the CLI under the user's home directory. */
  readonly home: string;
  /** The same CLI on Windows, when its path differs there. */
  readonly windows?: string;
  readonly args: readonly string[];
}

/** A catalog server Pi reaches at an HTTP endpoint, or starts as a local command. */
export type McpCatalogServer = { readonly id: McpCatalogId; readonly name: string } & (
  | { readonly url: string; readonly command?: undefined }
  | { readonly url?: undefined; readonly command: McpCatalogCommand }
);

/** MCP servers Piano can set up from Settings. Pi owns the configuration and the sign-in. */
export const MCP_CATALOG: readonly McpCatalogServer[] = [
  {
    id: "linear",
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
  },
  {
    id: "jira",
    name: "Jira",
    url: "https://mcp.atlassian.com/v2/mcp",
  },
  {
    // The Paper desktop app installs this CLI; Piano configures it, it does not install it.
    id: "paper",
    name: "Paper",
    command: { home: ".paper/bin/paper", windows: ".paper/bin/paper.exe", args: ["mcp"] },
  },
];
export const McpCatalogId = Schema.Literals(["linear", "jira", "paper"]);
export type McpCatalogId = typeof McpCatalogId.Type;

/** Machine-wide observations of Pi's global configuration and credentials, not live session connectivity. */
export const McpServerSetup = Schema.Struct({
  id: McpCatalogId,
  status: Schema.Literals(["missing", "ready", "blocked"]),
  detail: Schema.optional(Schema.String),
  /** Whether Pi signs in to this entry with MCP OAuth; false when it sends a configured
   * Authorization header, and false for a local command, which Pi starts without signing in. */
  oauth: Schema.Boolean,
  signedIn: Schema.Boolean,
  /** Opaque identity of the configuration reviewed before confirming removal. */
  removalKey: Schema.optional(Schema.String),
});
export type McpServerSetup = typeof McpServerSetup.Type;
export const McpSetupState = Schema.Struct({ servers: Schema.Array(McpServerSetup) });
export type McpSetupState = typeof McpSetupState.Type;

export const McpSetupRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literals(["install", "sign-out"]), server: McpCatalogId }),
  Schema.Struct({
    action: Schema.Literal("uninstall"),
    server: McpCatalogId,
    removalKey: Schema.String,
  }),
]);
export type McpSetupRequest = typeof McpSetupRequest.Type;
