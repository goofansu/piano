import { useEffect, useState } from "react";
import { createPreference } from "../../../web/src/shared/lib/preference.ts";
import { type Navigation } from "../../../web/src/shared/navigation/navigation.ts";
import {
  browserAddressBar,
  browserSurfaceMemory,
  createNavigation,
  type NavigationOptions,
} from "./navigation.ts";

const railPreference = createPreference<boolean>({
  key: "piano.details",
  decode: (raw) => raw === "true",
});

export function useNavigationController(
  client: NavigationOptions["client"],
  moved: () => void,
  readFile: NavigationOptions["readFile"],
): Navigation {
  const [navigation] = useState(() =>
    createNavigation({
      client,
      address: browserAddressBar,
      readFile,
      memory: browserSurfaceMemory(),
      rail: railPreference,
      moved,
    }),
  );
  useEffect(() => navigation.start(), [navigation]);
  return navigation;
}
