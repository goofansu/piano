import { useEffect } from "react";
import { oauthProviders } from "./api";
import { useObservation } from "./useObservation";

/** One observation in CommandHost serves both menu surfaces. No MCP or model availability gate. */
export function useRadiusSignedIn(connected: boolean) {
  const observed = useObservation("share-provider", (signal) => oauthProviders({ signal }), {
    enabled: connected,
    focus: true,
    interval: () => 30_000,
  });
  const { refresh } = observed;
  useEffect(() => {
    const changed = () => void refresh();
    window.addEventListener("piano:providers-changed", changed);
    return () => window.removeEventListener("piano:providers-changed", changed);
  }, [refresh]);
  return (
    connected &&
    !observed.error &&
    !!observed.value?.some((provider) => provider.id === "radius" && provider.signedIn)
  );
}
