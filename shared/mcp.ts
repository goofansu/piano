import { Schema } from "effect";

/** A catalog server: an HTTP endpoint Pi reaches, ready to sign in to. */
export interface McpCatalogServer {
  readonly id: McpCatalogId;
  readonly name: string;
  readonly url: string;
}

/** MCP servers Piano offers to connect from Settings. Pi owns the configuration and the sign-in.
 * Any other server, a local command among them, is added by the user. */
export const MCP_CATALOG: readonly McpCatalogServer[] = [
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp" },
  { id: "jira", name: "Jira", url: "https://mcp.atlassian.com/v2/mcp" },
];
export const McpCatalogId = Schema.Literals(["linear", "jira"]);
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

/**
 * How Pi authenticates an entry, in Pi's order: a local command needs nothing; a URL server sends
 * a `/login` provider's token when the entry names one, else its own `Authorization` header, else
 * signs in with MCP OAuth. Only `oauth` signs in from the MCP page.
 */
export const McpAuthView = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("command") }),
  Schema.Struct({ kind: Schema.Literal("provider"), provider: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("header") }),
  Schema.Struct({ kind: Schema.Literal("oauth") }),
]);
export type McpAuthView = typeof McpAuthView.Type;

/** One entry of Pi's global `mcp.json`: a machine-wide observation, not live session connectivity. */
export const McpServerSetup = Schema.Struct({
  /** Pi's entry name: the key in `mcpServers` and the namespace of the server's tools. */
  name: Schema.String,
  /** The catalog server this entry is, matched by its endpoint or command. */
  catalog: Schema.optional(McpCatalogId),
  config: McpServerConfigView,
  /** A configuration problem the user must fix in Pi, such as the entry being disabled. */
  detail: Schema.optional(Schema.String),
  /** How Pi authenticates this entry, as Pi decides it. */
  auth: McpAuthView,
  signedIn: Schema.Boolean,
  /** Opaque identity of the configuration reviewed before editing or confirming removal. */
  removalKey: Schema.String,
});
export type McpServerSetup = typeof McpServerSetup.Type;

/** A catalog server not configured yet, or one whose default name another entry holds. */
export const McpAvailableServer = Schema.Struct({
  id: McpCatalogId,
  /** Why it cannot be connected as is. */
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

/** The dialog's fields a refused save can name: its name, or the server's configuration. */
export const MCP_FIELDS = ["name", "config"] as const;
export type McpField = (typeof MCP_FIELDS)[number];

/**
 * What the dialog's form saves, adding or editing: the fields it shows. The server merges them
 * into the entry (an empty one when adding), keeping Pi's other keys; the `Authorization` header
 * is only ever `authorization`, never a row of `headers`. `authorization` left out keeps the saved
 * header, `null` removes it. Pasted JSON is Pi's own `mcpServers` shape instead, which Pi validates.
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

/**
 * A change to the setup. A URL server is saved only once Piano has connected to it: `connect` (a
 * catalog server), `add` and `update` answer with `signIn` instead of saving when it needs an
 * OAuth sign-in first, and the sign-in saves it. A local command is saved only once it has started.
 */
export const McpSetupRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literal("connect"), server: McpCatalogId }),
  Schema.Struct({
    action: Schema.Literal("add"),
    name: Schema.String,
    /** The form's fields, merged into a new entry as an edit is. */
    form: McpServerEdit,
  }),
  Schema.Struct({
    action: Schema.Literal("add"),
    name: Schema.String,
    /** Pi's own entry shape, as a README documents it and the user pasted it. */
    config: Schema.Unknown,
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
]);
export type McpSetupRequest = typeof McpSetupRequest.Type;

/** A change's answer: the setup, and, when nothing was saved yet because the server asked for a
 * sign-in first, the sign-in subject that saves this change. It is the change's own, not the entry
 * name: signing in to the saved entry by name never saves a change left waiting. */
export const McpSetupChange = Schema.Struct({
  state: McpSetupState,
  signIn: Schema.optional(Schema.String),
});
export type McpSetupChange = typeof McpSetupChange.Type;
