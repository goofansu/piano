import { useSyncExternalStore } from "react";
import { oauthProviders, providerLogout } from "./api.ts";
import { createProviderAccounts } from "./providerAccounts.ts";

/** The page's provider accounts; App follows the client's connection with them. */
export const providerAccounts = createProviderAccounts({
  load: (signal) => oauthProviders({ signal }),
  logout: (provider) => providerLogout(provider),
});

/** The provider accounts as last read, shared by every surface that shows them. */
export function useProviderAccounts() {
  return useSyncExternalStore(providerAccounts.subscribe, providerAccounts.getState);
}
