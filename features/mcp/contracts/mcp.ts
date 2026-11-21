import { Schema } from "effect";

export interface McpCatalogServer {
  readonly id: McpCatalogId;
  readonly name: string;
  readonly url: string;
}

export const MCP_CATALOG: readonly McpCatalogServer[] = [
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp" },
  { id: "jira", name: "Jira", url: "https://mcp.atlassian.com/v2/mcp" },
];
export const McpCatalogId = Schema.Literals(["linear", "jira"]);
export type McpCatalogId = typeof McpCatalogId.Type;

const Headers = Schema.Record(Schema.String, Schema.String);

export const McpHttpConfig = Schema.Struct({
  url: Schema.String,
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

export const McpAuthView = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("command") }),
  Schema.Struct({ kind: Schema.Literal("provider"), provider: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("header") }),
  Schema.Struct({ kind: Schema.Literal("oauth") }),
]);
export type McpAuthView = typeof McpAuthView.Type;

export const McpServerSetup = Schema.Struct({
  name: Schema.String,
  catalog: Schema.optional(McpCatalogId),
  config: McpServerConfigView,
  detail: Schema.optional(Schema.String),
  auth: McpAuthView,
  signedIn: Schema.Boolean,
  removalKey: Schema.String,
});
export type McpServerSetup = typeof McpServerSetup.Type;

export const McpAvailableServer = Schema.Struct({
  id: McpCatalogId,
  detail: Schema.optional(Schema.String),
});
export type McpAvailableServer = typeof McpAvailableServer.Type;

export const McpSetupState = Schema.Struct({
  servers: Schema.Array(McpServerSetup),
  available: Schema.Array(McpAvailableServer),
  problem: Schema.optional(Schema.String),
});
export type McpSetupState = typeof McpSetupState.Type;

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
  Schema.Struct({ action: Schema.Literal("connect"), server: McpCatalogId }),
  Schema.Struct({
    action: Schema.Literal("add"),
    name: Schema.String,
    form: McpServerEdit,
  }),
  Schema.Struct({
    action: Schema.Literal("add"),
    name: Schema.String,
    config: Schema.Unknown,
  }),
  Schema.Struct({
    action: Schema.Literal("update"),
    name: Schema.String,
    removalKey: Schema.String,
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

export const McpSetupChange = Schema.Struct({
  state: McpSetupState,
  signIn: Schema.optional(Schema.String),
});
export type McpSetupChange = typeof McpSetupChange.Type;
