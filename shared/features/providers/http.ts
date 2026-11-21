import { Schema } from "effect";
import { endpoint } from "../../endpoint.ts";
import { signInEndpoints } from "../../signInEndpoints.ts";
import { OAuthProvider } from "../../wire.ts";
import { ApiKeyProvider, ProviderApiKeyChange } from "./providerApiKeys.ts";

export const providerEndpoints = {
  providerApiKeys: endpoint({
    method: "GET",
    path: "/api/provider-api-keys",
    noStore: true,
    response: Schema.Struct({ providers: Schema.Array(ApiKeyProvider) }),
    refused: 502,
    fallback: "Could not load API keys.",
  }),
  changeProviderApiKey: endpoint({
    method: "POST",
    path: "/api/provider-api-keys",
    body: ProviderApiKeyChange,
    invalid: "Invalid API key request.",
    noStore: true,
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    refused: 409,
    fallback: "Could not change API key. Check the key and try again.",
  }),
  oauthProviders: endpoint({
    method: "GET",
    path: "/api/oauth-providers",
    noStore: true,
    response: Schema.Struct({ providers: Schema.Array(OAuthProvider) }),
    refused: 502,
    fallback: "Could not load providers.",
  }),
  providerLogout: endpoint({
    method: "POST",
    path: "/api/provider-logout",
    body: Schema.Struct({ provider: Schema.String }),
    invalid: "Invalid sign-out request.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    refused: 409,
    fallback: "Could not sign out. Try again.",
  }),
  providerLogin: signInEndpoints("/api/provider-login"),
} as const;
