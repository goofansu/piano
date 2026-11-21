import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { radiusSetup } from "./radiusApi.ts";
import {
  createRadiusSetup,
  type RadiusAccounts,
  type RadiusSetup,
  type RadiusSetupSnapshot,
} from "./radiusSetup.ts";

export function useRadiusSetup(accounts: RadiusAccounts): RadiusSetup & RadiusSetupSnapshot {
  const [setup] = useState(() =>
    createRadiusSetup({
      api: radiusSetup,
      accounts,
      toast: (message, options) => toast.success(message, options),
    }),
  );
  useEffect(() => setup.start(), [setup]);
  const state = useSyncExternalStore(setup.subscribe, setup.getState);
  return { ...setup, ...state };
}
