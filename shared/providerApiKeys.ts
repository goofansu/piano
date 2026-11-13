import { Schema } from "effect";

/**
 * Piano's API-key setup catalog, shown in this order: keep it alphabetical by name. Add a
 * single-key Pi provider and its local logo here.
 */
export const API_KEY_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", logo: "deepseek" },
  { id: "fireworks", name: "Fireworks", logo: "fireworks" },
  { id: "google", name: "Google", logo: "google" },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", logo: "vercel" },
] as const;

export const ApiKeyProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  logo: Schema.String,
  saved: Schema.Boolean,
});
export type ApiKeyProvider = typeof ApiKeyProvider.Type;

/** `key` is read as a literal secret by ProviderLogin, which owns its refusal (literalSecret.ts). */
export const ProviderApiKeyChange = Schema.Union([
  Schema.Struct({ action: Schema.Literal("save"), provider: Schema.String, key: Schema.String }),
  Schema.Struct({ action: Schema.Literal("remove"), provider: Schema.String }),
]);
export type ProviderApiKeyChange = typeof ProviderApiKeyChange.Type;
