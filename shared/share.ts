import { Schema } from "effect";

/** Durable integration identity only; no credentials, transcript or artifact contents. */
export const RadiusShareLink = Schema.Struct({
  organizationId: Schema.String.check(Schema.isMinLength(1)),
  artifactId: Schema.String.check(Schema.isMinLength(1)),
  url: Schema.String,
});
export type RadiusShareLink = typeof RadiusShareLink.Type;

/** A confirmed Radius publication, not a promise that uploading has started. */
export const SessionShare = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.String,
  visibility: Schema.Literal("organization"),
});
export type SessionShare = typeof SessionShare.Type;
