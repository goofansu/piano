import { Schema } from "effect";

/** A confirmed Radius publication, not a promise that uploading has started. */
export const SessionShare = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.String,
  visibility: Schema.Literal("organization"),
});
export type SessionShare = typeof SessionShare.Type;
