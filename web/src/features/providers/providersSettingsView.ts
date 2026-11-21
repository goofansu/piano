import type { OAuthProvider } from "@shared/wire";

export interface ProvidersSettingsInput {
  value: readonly OAuthProvider[] | undefined;
  failure: boolean;
  signingOut: string | undefined;
}

export interface ProviderRowAction {
  label: "Sign in" | "Sign out" | "Signing out…";
  ariaLabel: string;
  primary: boolean;
  enabled: boolean;
  intent: "sign-in" | "confirm-sign-out";
}

export interface ProviderRow {
  provider: OAuthProvider;
  logo?: string;
  action: ProviderRowAction;
}

export type ProvidersSettingsBody =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "list"; rows: readonly ProviderRow[] };

export interface ProvidersSettingsView {
  body: ProvidersSettingsBody;
  providers: readonly OAuthProvider[];
}

const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  "github-copilot": "github-copilot",
  "kimi-coding": "kimi",
  meta: "meta",
  openrouter: "openrouter",
  xai: "xai",
};

const logoOf = (id: string) => (Object.hasOwn(PROVIDER_LOGOS, id) ? PROVIDER_LOGOS[id] : undefined);

function action(provider: OAuthProvider, signingOut: string | undefined): ProviderRowAction {
  return {
    label: signingOut === provider.id ? "Signing out…" : provider.signedIn ? "Sign out" : "Sign in",
    ariaLabel: `${provider.signedIn ? "Sign out of" : "Sign in to"} ${provider.name}`,
    primary: !provider.signedIn,
    enabled: !signingOut,
    intent: provider.signedIn ? "confirm-sign-out" : "sign-in",
  };
}

export function providersSettingsView({
  value,
  failure,
  signingOut,
}: ProvidersSettingsInput): ProvidersSettingsView {
  const providers = value?.filter((provider) => provider.id !== "radius");
  const body: ProvidersSettingsBody = failure
    ? { kind: "error" }
    : !providers
      ? { kind: "loading" }
      : providers.length > 0
        ? {
            kind: "list",
            rows: providers.map((provider) => ({
              provider,
              logo: logoOf(provider.id),
              action: action(provider, signingOut),
            })),
          }
        : value?.length === 0
          ? { kind: "empty" }
          : { kind: "hidden" };
  return { body, providers: providers ?? [] };
}
