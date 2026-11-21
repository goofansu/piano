import { Schema } from "effect";

export const RadiusSetupStep = Schema.Struct({
  status: Schema.Literals(["missing", "ready", "blocked"]),
  detail: Schema.optional(Schema.String),
  removalKey: Schema.optional(Schema.String),
});
export type RadiusSetupStep = typeof RadiusSetupStep.Type;
export const RadiusSetupState = Schema.Struct({
  mcp: RadiusSetupStep,
  webSearch: RadiusSetupStep,
  installation: Schema.Struct({
    status: Schema.Literals(["idle", "running", "success", "error"]),
    action: Schema.optional(Schema.Literals(["install", "uninstall"])),
    detail: Schema.optional(Schema.String),
  }),
});
export type RadiusSetupState = typeof RadiusSetupState.Type;

export const RadiusSetupAction = Schema.Literals([
  "configure-mcp",
  "install-web-search",
  "remove-mcp",
  "uninstall-web-search",
]);
export type RadiusSetupAction = typeof RadiusSetupAction.Type;

export const RadiusSetupRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literals(["configure-mcp", "install-web-search"]) }),
  Schema.Struct({
    action: Schema.Literals(["remove-mcp", "uninstall-web-search"]),
    removalKey: Schema.String,
  }),
]);
export type RadiusSetupRequest = typeof RadiusSetupRequest.Type;
