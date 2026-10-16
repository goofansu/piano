import { Schema } from "effect";

export const NotificationSettings = Schema.Struct({
  /** Positive detection is remembered only for this backend's lifetime. */
  detected: Schema.Boolean,
  webhook: Schema.NullOr(Schema.String),
  problem: Schema.optional(Schema.String),
});
export type NotificationSettings = typeof NotificationSettings.Type;
export const NotificationAction = Schema.Union([
  Schema.Struct({ action: Schema.Literal("save"), url: Schema.String }),
  Schema.Struct({ action: Schema.Literal("remove") }),
  Schema.Struct({ action: Schema.Literal("test") }),
]);
export type NotificationAction = typeof NotificationAction.Type;
