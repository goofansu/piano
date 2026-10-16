import { Schema } from "effect";

export const NotificationSettings = Schema.Struct({
  /** Null means discovery unavailable; an empty array is a successful empty catalog. */
  integrations: Schema.NullOr(Schema.Array(Schema.String)),
  /** Preserve a saved name even if it is no longer in the catalog. */
  selected: Schema.NullOr(Schema.String),
  problem: Schema.optional(Schema.String),
});
export type NotificationSettings = typeof NotificationSettings.Type;
export const NotificationAction = Schema.Union([
  Schema.Struct({ action: Schema.Literal("select"), name: Schema.NullOr(Schema.String) }),
  Schema.Struct({ action: Schema.Literal("test") }),
  Schema.Struct({ action: Schema.Literal("refresh") }),
]);
export type NotificationAction = typeof NotificationAction.Type;
