import { useSyncExternalStore } from "react";
import { createProviderAccounts } from "./providerAccounts.ts";
import { oauthProviders, providerLogout } from "./providerApi.ts";

export const providerAccounts = createProviderAccounts({
  load: (signal) => oauthProviders({ signal }),
  logout: (provider) => providerLogout(provider),
});

export function useProviderAccounts() {
  return useSyncExternalStore(providerAccounts.subscribe, providerAccounts.getState);
}
