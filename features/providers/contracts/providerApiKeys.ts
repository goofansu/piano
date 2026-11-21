import { Schema } from "effect";

export const API_KEY_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", logo: "deepseek" },
  { id: "fireworks", name: "Fireworks", logo: "fireworks" },
  { id: "google", name: "Google", logo: "google" },
  { id: "opencode-go", name: "OpenCode Go", logo: "opencode" },
  { id: "opencode", name: "OpenCode Zen", logo: "opencode" },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", logo: "vercel" },
] as const;

export const ApiKeyProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  logo: Schema.String,
  saved: Schema.Boolean,
});
export type ApiKeyProvider = typeof ApiKeyProvider.Type;

export const ProviderApiKeyChange = Schema.Union([
  Schema.Struct({ action: Schema.Literal("save"), provider: Schema.String, key: Schema.String }),
  Schema.Struct({ action: Schema.Literal("remove"), provider: Schema.String }),
]);
export type ProviderApiKeyChange = typeof ProviderApiKeyChange.Type;
