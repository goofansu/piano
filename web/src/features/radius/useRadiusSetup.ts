import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { providerAccounts } from "../providers/useProviderAccounts.ts";
import { radiusSetup } from "./radiusApi.ts";
import { createRadiusSetup, type RadiusSetup, type RadiusSetupSnapshot } from "./radiusSetup.ts";

export function useRadiusSetup(): RadiusSetup & RadiusSetupSnapshot {
  const [setup] = useState(() =>
    createRadiusSetup({
      api: radiusSetup,
      accounts: providerAccounts,
      toast: (message, options) => toast.success(message, options),
    }),
  );
  useEffect(() => setup.start(), [setup]);
  const state = useSyncExternalStore(setup.subscribe, setup.getState);
  return { ...setup, ...state };
}
