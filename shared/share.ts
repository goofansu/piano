import { Schema } from "effect";
import { isRadiusUrl } from "./radiusUrl.ts";

export const SESSION_SHARE_TIMEOUT_MS = 60_000;
export const SESSION_SHARE_MAX_BYTES = 10 * 1024 * 1024;
export const SHARE_NOT_SENT =
  "Could not start sharing with Radius. Nothing was uploaded; share again.";
export const SHARE_UNCONFIRMED =
  "Could not confirm sharing. Radius may have created an artifact. Check Radius before sharing again; Piano has not retried.";

export const SessionShare = Schema.Struct({
  url: Schema.String.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter((value) => isRadiusUrl(value)),
  ),
  visibility: Schema.Literals(["private", "organization", "public"]),
  expiresAt: Schema.String.check(Schema.makeFilter((value) => Number.isFinite(Date.parse(value)))),
});
export type SessionShare = typeof SessionShare.Type;

export const SessionShareResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("shared"), share: SessionShare }),
  Schema.Struct({ status: Schema.Literal("sign-in-required") }),
]);
export type SessionShareResult = typeof SessionShareResult.Type;
