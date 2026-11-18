import { Schema } from "effect";

export const SESSION_SHARE_TIMEOUT_MS = 60_000;
export const SESSION_SHARE_MAX_BYTES = 10 * 1024 * 1024;
export const SHARE_UNCONFIRMED =
  "Could not confirm sharing. Radius may have created an artifact. Check Radius before sharing again; Piano has not retried.";

export const SessionShare = Schema.Struct({
  url: Schema.String.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          !url.search &&
          !url.hash &&
          url.pathname !== "/" &&
          ["radius.pi.dev", "radius.earendil.com"].includes(url.hostname)
        );
      } catch {
        return false;
      }
    }),
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
