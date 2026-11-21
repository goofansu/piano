import { Schema } from "effect";
import { endpoint, type NoPathParams } from "./endpoint.ts";
import { ProviderLoginState } from "./wire.ts";

export const signInEndpoints = <const P extends `/api/${string}`>(path: NoPathParams<P>) => {
  const shared = {
    path,
    invalid: "Invalid sign-in request.",
    response: Schema.Struct({ state: Schema.NullOr(ProviderLoginState) }),
    noStore: true,
    refused: 409,
    redact: false,
    fallback: "Could not complete sign-in.",
  } as const;
  return {
    state: endpoint({ ...shared, method: "GET" }),
    start: endpoint({
      ...shared,
      method: "POST",
      body: Schema.Struct({ provider: Schema.String }),
    }),
    answer: endpoint({
      ...shared,
      method: "PUT",
      body: Schema.Struct({
        id: Schema.String,
        promptId: Schema.String,
        value: Schema.String.check(Schema.isMaxLength(16_384)),
      }),
    }),
    cancel: endpoint({ ...shared, method: "DELETE", body: Schema.Struct({ id: Schema.String }) }),
  };
};
export type SignInEndpoints = ReturnType<typeof signInEndpoints>;
