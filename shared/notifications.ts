import { Schema } from "effect";

export const NotificationSettings = Schema.Struct({
  /** Positive detection is remembered only for this backend's lifetime. */
  detected: Schema.Boolean,
  webhooks: Schema.Array(Schema.String),
  problem: Schema.optional(Schema.String),
});
export type NotificationSettings = typeof NotificationSettings.Type;
export const NotificationAction = Schema.Struct({
  action: Schema.Literals(["add", "remove", "test"]),
  url: Schema.String,
});
export type NotificationAction = typeof NotificationAction.Type;
