import { Schema } from "effect";

export const CreationAttempt = Schema.Struct({
  id: Schema.String,
  fingerprint: Schema.String,
  sessionId: Schema.String,
  cwd: Schema.String,
  state: Schema.Literals(["starting", "created", "failed", "uncertain"]),
  detail: Schema.optional(Schema.String),
});
export type CreationAttempt = typeof CreationAttempt.Type;
