import { useSyncExternalStore } from "react";
import { oauthProviders, providerLogout } from "./api.ts";
import { createProviderAccounts } from "./providerAccounts.ts";

export const providerAccounts = createProviderAccounts({
  load: (signal) => oauthProviders({ signal }),
  logout: (provider) => providerLogout(provider),
});

export function useProviderAccounts() {
  return useSyncExternalStore(providerAccounts.subscribe, providerAccounts.getState);
}
