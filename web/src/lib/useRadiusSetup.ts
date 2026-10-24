import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { radiusSetup } from "./api.ts";
import { createRadiusSetup, type RadiusSetup, type RadiusSetupSnapshot } from "./radiusSetup.ts";
import { providerAccounts } from "./useProviderAccounts.ts";

/** The Radius section's setup while mounted, over the page's provider accounts. */
export function useRadiusSetup(): RadiusSetup & RadiusSetupSnapshot {
  const [setup] = useState(() =>
    createRadiusSetup({
      api: radiusSetup,
      accounts: providerAccounts,
      toast: (message, options) => toast.success(message, options),
      failure: (message) => toast.error(message),
    }),
  );
  useEffect(() => setup.start(), [setup]);
  const state = useSyncExternalStore(setup.subscribe, setup.getState);
  return { ...setup, ...state };
}
