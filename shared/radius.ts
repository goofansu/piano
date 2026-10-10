import { Schema } from "effect";

/** Machine-wide Radius setup observations, not live session connectivity or tool authorization. */
export const RadiusSetupStep = Schema.Struct({
  status: Schema.Literals(["missing", "ready", "blocked"]),
  detail: Schema.optional(Schema.String),
  /** Opaque identity of the configuration reviewed before confirming removal. */
  removalKey: Schema.optional(Schema.String),
});
export type RadiusSetupStep = typeof RadiusSetupStep.Type;
export const RadiusSetupState = Schema.Struct({
  mcp: RadiusSetupStep,
  webSearch: RadiusSetupStep,
  /** One server-owned package operation; navigation never cancels it. */
  installation: Schema.Struct({
    status: Schema.Literals(["idle", "running", "success", "error"]),
    action: Schema.optional(Schema.Literals(["install", "uninstall"])),
    detail: Schema.optional(Schema.String),
  }),
});
export type RadiusSetupState = typeof RadiusSetupState.Type;
