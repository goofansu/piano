import { Schema } from "effect";

/** MCP servers Piano can set up from Settings. Pi owns the configuration and the sign-in. */
export const MCP_CATALOG: readonly { id: McpCatalogId; name: string; url: string; description: string }[] = [
  {
    id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp",
    description: "Let Pi find, create and update Linear issues, projects and comments.",
  },
];
export const McpCatalogId = Schema.Literals(["linear"]);
export type McpCatalogId = typeof McpCatalogId.Type;

/** Machine-wide observations of Pi's global configuration and credentials, not live session connectivity. */
export const McpServerSetup = Schema.Struct({
  id: McpCatalogId,
  status: Schema.Literals(["missing", "ready", "blocked"]),
  detail: Schema.optional(Schema.String),
  /** Whether Pi signs in to this entry with MCP OAuth; false when it sends a configured Authorization header. */
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
  Schema.Struct({ action: Schema.Literal("uninstall"), server: McpCatalogId, removalKey: Schema.String }),
]);
export type McpSetupRequest = typeof McpSetupRequest.Type;
