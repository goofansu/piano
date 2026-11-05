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

/** MCP servers Piano offers to install from Settings, ready to sign in to. Pi owns the
 * configuration and the sign-in. Any other server is added by the user. */
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

const Headers = Schema.Record(Schema.String, Schema.String);

/**
 * An entry's configuration as the browser edits it: an HTTP endpoint with its headers, or a local
 * command. The `Authorization` header's value never leaves the machine: the browser learns only
 * that one is set. Pi's other keys (exposure, timeout, OAuth client settings) stay as configured.
 */
export const McpHttpConfig = Schema.Struct({
  url: Schema.String,
  /** Headers other than `Authorization`. */
  headers: Headers,
  hasAuthorization: Schema.Boolean,
});
export const McpCommandConfig = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  env: Headers,
  cwd: Schema.optional(Schema.String),
});
export const McpServerConfigView = Schema.Union([McpHttpConfig, McpCommandConfig]);
export type McpServerConfigView = typeof McpServerConfigView.Type;

/** One entry of Pi's global `mcp.json`: a machine-wide observation, not live session connectivity. */
export const McpServerSetup = Schema.Struct({
  /** Pi's entry name: the key in `mcpServers` and the namespace of the server's tools. */
  name: Schema.String,
  /** The catalog server this entry is, matched by its endpoint or command. */
  catalog: Schema.optional(McpCatalogId),
  config: McpServerConfigView,
  /** A configuration problem the user must fix in Pi, such as the entry being disabled. */
  detail: Schema.optional(Schema.String),
  /** Whether Pi signs in to this entry with MCP OAuth; false when it sends a configured
   * Authorization header, and false for a local command, which Pi starts without signing in. */
  oauth: Schema.Boolean,
  signedIn: Schema.Boolean,
  /** Opaque identity of the configuration reviewed before editing or confirming removal. */
  removalKey: Schema.String,
});
export type McpServerSetup = typeof McpServerSetup.Type;

/** A catalog server not configured yet, or one whose default name another entry holds. */
export const McpAvailableServer = Schema.Struct({
  id: McpCatalogId,
  /** Why it cannot be installed as is. */
  detail: Schema.optional(Schema.String),
});
export type McpAvailableServer = typeof McpAvailableServer.Type;

export const McpSetupState = Schema.Struct({
  /** Every entry of Pi's global file, in its order. */
  servers: Schema.Array(McpServerSetup),
  /** Catalog servers no entry is, in catalog order. */
  available: Schema.Array(McpAvailableServer),
  /** Pi's MCP configuration cannot be used until the user fixes it in Pi: nothing can change. */
  problem: Schema.optional(Schema.String),
});
export type McpSetupState = typeof McpSetupState.Type;

/**
 * What the dialog saves. Adding sends Pi's own `mcpServers` shape, as a form builds it or as a
 * README documents it, and Pi validates it. Editing sends the fields the dialog shows; the server
 * merges them into the entry, keeping Pi's other keys, and `authorization` left out keeps the saved
 * header, `null` removes it.
 */
export const McpServerEdit = Schema.Union([
  Schema.Struct({
    url: Schema.String,
    headers: Headers,
    authorization: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    command: Schema.String,
    args: Schema.Array(Schema.String),
    env: Headers,
    cwd: Schema.optional(Schema.String),
  }),
]);
export type McpServerEdit = typeof McpServerEdit.Type;

export const McpSetupRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literal("install"), server: McpCatalogId }),
  Schema.Struct({
    action: Schema.Literal("add"),
    servers: Schema.Array(Schema.Struct({ name: Schema.String, config: Schema.Unknown })),
  }),
  Schema.Struct({
    action: Schema.Literal("update"),
    name: Schema.String,
    removalKey: Schema.String,
    /** The entry's new name; the same name keeps it. */
    rename: Schema.optional(Schema.String),
    config: McpServerEdit,
  }),
  Schema.Struct({
    action: Schema.Literal("remove"),
    name: Schema.String,
    removalKey: Schema.String,
  }),
  Schema.Struct({ action: Schema.Literal("sign-out"), name: Schema.String }),
]);
export type McpSetupRequest = typeof McpSetupRequest.Type;
