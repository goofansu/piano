/**
 * What the Providers page's "Accounts" list shows and allows: whether the list shows at
 * all, its load, failure and empty states, and one row per OAuth provider with its logo and its
 * sign-in or sign-out control. Radius is left out because its own section carries it. A sign-out
 * in flight disables every row. Pure; the page renders it.
 */
import type { OAuthProvider } from "@shared/wire";

export interface ProvidersSettingsInput {
  /** Pi's OAuth providers as last read; absent until the first read succeeds. */
  value: readonly OAuthProvider[] | undefined;
  /** The last read failed. */
  failure: boolean;
  /** The id of the provider whose sign-out is in flight. */
  signingOut: string | undefined;
}

export interface ProviderRowAction {
  label: "Sign in" | "Sign out" | "Signing out…";
  ariaLabel: string;
  /** Signing in is the row's call to action; signing out stays quiet. */
  primary: boolean;
  enabled: boolean;
  /** Signing out asks for confirmation first. */
  intent: "sign-in" | "confirm-sign-out";
}

export interface ProviderRow {
  provider: OAuthProvider;
  /** Name of the logo in `/provider-logos/`; absent for providers Piano has no logo for. */
  logo?: string;
  action: ProviderRowAction;
}

export type ProvidersSettingsBody =
  /** Radius is the only provider, and its own section already covers it. */
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error" }
  /** Pi offers no OAuth provider at all. */
  | { kind: "empty" }
  | { kind: "list"; rows: readonly ProviderRow[] };

export interface ProvidersSettingsView {
  body: ProvidersSettingsBody;
  /** The providers the sign-in dialog offers: every one but Radius, none until read. */
  providers: readonly OAuthProvider[];
}

// Pi owns the provider catalog; unknown/custom providers intentionally have no logo. Radius is
// absent because its own section, not a list row, carries it.
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
  // Radius has its own section, with the steps that sign-in alone does not cover.
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
