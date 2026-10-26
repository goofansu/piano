import { Schema } from "effect";

/** Piano's API-key setup catalog. Add a single-key Pi provider and its local logo here. */
export const API_KEY_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", logo: "deepseek" },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", logo: "vercel" },
] as const;

/** The one refusal of a key that is not literal, at the endpoint and in the service alike. */
export const API_KEY_INVALID = "Enter a valid API key, not a command.";

/** Literal keys only: Pi interprets a leading ! as a command in auth.json. */
export const ProviderApiKey = Schema.String.check(
  Schema.isPattern(/^[^\s!]\S*$/u),
  Schema.isMaxLength(8192),
);

export const ApiKeyProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  logo: Schema.String,
  saved: Schema.Boolean,
});
export type ApiKeyProvider = typeof ApiKeyProvider.Type;

export const ProviderApiKeyChange = Schema.Union([
  Schema.Struct({ action: Schema.Literal("save"), provider: Schema.String, key: ProviderApiKey }),
  Schema.Struct({ action: Schema.Literal("remove"), provider: Schema.String }),
]);
export type ProviderApiKeyChange = typeof ProviderApiKeyChange.Type;
